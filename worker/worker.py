import cv2
from nudenet import NudeDetector
import redis
import json
import subprocess
import boto3
import os
r = redis.Redis(host='localhost', port=6379, decode_responses=True)
p = redis.Redis(host='127.0.0.1', port=6380, decode_responses=True)
detector = NudeDetector()

all_labels = [
    "BUTTOCKS_EXPOSED",
    "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED",
    "ANUS_EXPOSED",
    "ARMPITS_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
]
data = r.brpop("queue")[1]
video_path = json.loads(data)["url"]
nanoid = json.loads(data)['nanoid']
print("Received video path from queue:",type(video_path), video_path)
now = {"url":video_path,"nanoid":nanoid,"status":"processing"}
p.publish("processing", json.dumps(now))

cap = cv2.VideoCapture(video_path)

frame_count = 0
toBeSent={
    "manifest_url":"",
    "nanoid":nanoid,
    "flagged":False,
    "url":video_path,
    "detection":{
        "nudity":{
    "flagged":False,
    "flagged_frame_ratio":0,
    "details":[]
        }
    }
}
while True:
    success, frame = cap.read()

    if not success:
        print("Failed to read frame from video.")   
        break

    frame_count += 1

    if frame_count % 30 != 0:
        continue

    frame_path = f"temp_frame.jpg"

    cv2.imwrite(frame_path, frame)

    detections = detector.detect(frame_path)

    failed = False
    is_flagged = False

    for item in detections:
        if item["class"] in all_labels and item["score"] > 0.5:
            failed = True
            is_flagged = True
            break

    if failed:
        print(f"Frame {frame_count}: failed")
        toBeSent["flagged"] = True
        toBeSent["detection"]["nudity"]["details"].append({"frame": frame_count, "detections": {"class":item['class'],"score":item['score']}})

    else:
        print(f"Frame {frame_count}: passed")

cap.release()
print("Video processing completed.", toBeSent)

if toBeSent["flagged"]:
    toBeSent["detection"]["nudity"]["flagged_frame_ratio"] = len(toBeSent["detection"]["nudity"]["details"])/frame_count
else:
    toBeSent["detection"]["nudity"]["flagged_frame_ratio"] = 0
    # here is the logic of transcoding it 
    video_url = video_path
    os.makedirs("hls-output", exist_ok=True)
    subprocess.run([
    "ffmpeg",
    "-i", video_url,

    "-filter_complex",
    "[0:v]split=3[v1][v2][v3];"
    "[v1]scale=1920:1080[v1080];"
    "[v2]scale=1280:720[v720];"
    "[v3]scale=854:480[v480]",

    "-map", "[v1080]",
    "-c:v:0", "libx264",
    "-b:v:0", "5000k",

    "-map", "[v720]",
    "-c:v:1", "libx264",
    "-b:v:1", "2800k",

    "-map", "[v480]",
    "-c:v:2", "libx264",
    "-b:v:2", "1400k",

    "-map", "a:0",
    "-map", "a:0",
    "-map", "a:0",

    "-f", "hls",
    "-hls_time", "6",
    "-master_pl_name", "master.m3u8",

    "-var_stream_map",
    "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p",

    "-hls_segment_filename",
    "hls-output/%v/segment_%03d.ts",

    "hls-output/%v/index.m3u8"
])

    s3 = boto3.client(
    's3',
    endpoint_url='http://localhost:9000',
    aws_access_key_id='minioadmin',
    aws_secret_access_key='minioadmin',
    )
    bucket = 'js-test-bucket'
    local_folder = 'hls-output'
  

    s3.put_bucket_policy(
    Bucket='js-test-bucket',
    Policy=json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"AWS": ["*"]},
            "Action": ["s3:GetObject"],
            "Resource": ["arn:aws:s3:::js-test-bucket/*"]
        }]
    })
)

    for root, dirs, files in os.walk(local_folder):
        for file in files:
            local_path = os.path.join(root, file)
            s3_key = f"videos/{nanoid}/{os.path.relpath(local_path, local_folder).replace(os.sep, '/')}"  # preserves folder structure
            s3.upload_file(local_path, bucket, s3_key)
    manifest_url = f"http://localhost:9000/{bucket}/videos/{nanoid}/master.m3u8"
    toBeSent["manifest_url"] = manifest_url
q=p.publish("results", json.dumps(toBeSent))
print("Published results to channel 'results':", q)