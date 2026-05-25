import fs from 'fs';
import socket from 'socket.io-client';

async function main(){
const sock =  socket('http://localhost:3000');

sock.on('connect', () => {
  console.log('Connected to server');
});
sock.on('processing',()=>{
  console.log('The video sent is being processed')
})
sock.on('finished',(va)=>{
  const str = JSON.parse(va).flagged ? "failed" : "successful"
  console.log("publishing ",str,)
})
moderateVideo('testfile.mp4')
}
async function moderateVideo(videoPath) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(videoPath)], { type: 'video/mp4' }), 'video.mp4');

  const res = await fetch('http://localhost:3000/video/upload', {
    method: 'POST',
    body: form,
  });
  console.log(await res.json());

}
main();
