import mongoose from 'mongoose';

const videoSchema = new mongoose.Schema({
status:{
    type:String,
    enum:['pending','processing','accepted','rejected']
},
nanoid:String
,
manifest_url:String,
checks:{
    passed:Boolean,
    flags:{
        nudity:{
            flagged:Boolean,
            flagged_frame_ratio:Number,
            details:[
                {frame:Number,detections:[{label:String,score:Number}]}
            ]

        }
    }
}
}, { timestamps: true });

const Video = mongoose.model('Video', videoSchema);
export default Video;