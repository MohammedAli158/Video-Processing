import express from "express";
import redis from "redis";
import multer from "multer";
import mongoose from "mongoose";
import "dotenv/config"
import minio from "./minio.js";
import  Video  from "./database/video.model.js";
import { Server } from "socket.io";
import http from "http"
import { nanoid } from "./util/nanoid.js";
const main = async () => {
    const app = express();
    var client;
    var subscribe;
    const httpServer = http.createServer(app)
    const socket = new Server(httpServer,{
        cors:{
            origin:"*",
        }
    })
    socket.on("connection",(io)=>{
        console.log("a user connected")
        
    })
    // Redis connection
   try {
      client = redis.createClient();
      subscribe = redis.createClient({
        url:"redis://localhost:6380",
      });
 
     await client.connect();
     await subscribe.connect();
     await subscribe.subscribe("results", async(message) => {
    console.log(message,"this is log");
        socket.emit("finished",message)
        const url = JSON.parse(message).url;
        const nanoid = JSON.parse(message).nanoid;
        console.log("Received message on 'results' channel:", message,url,nanoid);
        try {
            const video = await Video.findOne({nanoid:nanoid});
            console.log("video found by the nanoid ",video)
            const messag = JSON.parse(message)
            if(video){
                video.manifest_url = messag.manifest_url;
                console.log("video manifest url updated ",video.manifest_url)
                video.checks.passed = messag.flagged;
                video.checks.flags.nudity = messag.detection.nudity;
                video.checks.flags.violence = messag.detection.violence;
                video.status = messag.flagged ? "rejected" : "accepted";
                await video.save();
                console.log("video status updated to finished ",video)
            }else{
                console.log("No video found")
            }
        } catch (error) {
            console.log(error)
        }

    });

   
    await subscribe.subscribe("processing", async(message) => {
        console.log(message,"this is log");
        socket.emit("processing",message)
        const url = JSON.parse(message).url;
         const nanoid = JSON.parse(message).nanoid;
        const video = await Video.findOne({nanoid:nanoid});
        if(video){
            video.status = "processing";
            await video.save();
        }

    });
   } catch (error) {
    console.log(error)
   }

    // Different MongoDB database connection
    const videoDB = await mongoose.connect(
        process.env.MONGO_DB_URI,
    )

    // Multer setup
    const upload = multer({
        dest: "uploads/",
    });

    app.post(
        "/video/upload",
        upload.single("file"),
        async (req, res) => {
            console.log("req came");
            try {
                const mimeType = req.file.mimetype;

                const presignedUrl = await minio(req.file.path);
                const nano = nanoid()
                await client.lPush(
                    "queue",
                    JSON.stringify({
                        url: presignedUrl,
                        nanoid:nano,
                        mimeType,
                    })
                );

                const VideoModel = Video.model("Video");

                const video = new VideoModel({
                    nanoid:nano,
                    status: "pending",
                });
                console.log("video by the url is being saved ",presignedUrl)
                await video.save();
                return res.json({
                    status: "okay",
                    videoStatus: "pending",
                });
            } catch (error) {
                console.log(error);

                return res.status(500).json({
                    error: "Upload failed",
                });
            }
        }
    );

    httpServer.listen(3000, () => {
    console.log("Server is running on port 3000");
});
};

main();