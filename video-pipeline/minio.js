import * as Minio from 'minio'
export default async function minio(sourceFile) {

const minioClient = new Minio.Client({
  endPoint: '127.0.0.1',
  port: 9000,
  useSSL: false,
  accessKey: 'minioadmin',
  secretKey: 'minioadmin',
})

const bucket = 'js-test-bucket'

const destinationObject = 'testfile.mp4'

const exists = await minioClient.bucketExists(bucket)
if (exists) {
  console.log('Bucket ' + bucket + ' exists.')
} else {
  await minioClient.makeBucket(bucket, 'us-east-1')
  console.log('Bucket ' + bucket + ' created in "us-east-1".')
}

var metaData = {
  'Content-Type': "video/mp4" ,
  'X-Amz-Meta-Testing': 1234,
  example: 5678,
}

await minioClient.fPutObject(bucket, destinationObject, sourceFile, metaData)
console.log('File ' + sourceFile + ' uploaded as object ' + destinationObject + ' in bucket ' + bucket)
const data = []
const presignedUrl = await minioClient.presignedUrl('GET', 'js-test-bucket', 'testfile.mp4', 24 * 60 * 60)
return presignedUrl
}