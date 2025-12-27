import express from "express";
import {createServer} from "http";
import {Server} from "socket.io";
import crypto from "crypto"
import fetch from "node-fetch";
import "dotenv/config";

const app = express();
const httpServer = createServer(app);

const origins = ["http://astra-the-boop.github.io", "https://astra-the-boop.github.io/campfire-portal/public", "https://astra-the-boop.github.io/campfire-portal"]

const io = new Server(httpServer, {
    cors: {
        origin(origin, callback) {
            if(!origin) return callback(null, true);
            if(origins.includes(origin)){
                return callback(null, true);
            }

            console.warn(`Blocked socket.io origin ${origin}`);
            return callback(new Error("Not allowed by CORS"));
        },
        methods: ["GET", "POST"]
    }
});

const events = {};
const apiKey = process.env.DAILY_API_KEY;

console.log(Boolean(process.env.DAILY_API_KEY));

async function createRoom(){
    const res = await fetch("https://api.daily.co/v1/rooms",{
        method: "POST",
        headers:{
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            properties:{
                exp: Math.floor(Date.now()/1000)+60*60*5,
                enable_chat: true,
                start_audio_off: false,
                start_video_off: false,
            }
        })
    });

    const data = await res.json();

    if(!data.url){
        console.log('Daily room creation failed', data);
        return null;
    }

    return data;
}

function getRandom(eventId){
    const candidates = Object.entries(events).filter(
        ([id,e])=>e.roomId&&id!==eventId
    ).map(([id])=>id);

    if(candidates.length ===0) return null;
    return candidates[Math.floor(Math.random()*candidates.length)];
}

function hasSockets(eventId){
    return Array.from(io.sockets.sockets.values()).some(
        socket => socket.data.eventId === eventId
    )
}

function leaveCall(socket){
    if(!socket.data.inCall) return;
    const {roomId, eventId} = socket.data;

    if(roomId){
        socket.leave(roomId);
    }

    const event = events[eventId]
    if(event){
        const room = io.sockets.adapter.rooms.get(roomId);
        if(!room || room.size === 0){
            event.roomId = null;
        }
    }

    socket.data.inCall = false;
    socket.data.roomId = null;
}

function serializeEvents(){
    return Object.entries(events).map(([id, e])=>{
        const participants = e.roomId? io.sockets.adapter.rooms.get(e.roomId)?.size??0:0;

        return{
            id,
            inCall:Boolean(e.roomId),
            name:e.name,
            participants
        }
    });
}

async function deleteRoom(roomName){
    if(!roomName) return;

    await fetch(`https://api.daily.co/v1/rooms/${roomName}`,{
        method: "DELETE",
        headers:{
            "Authorization": `Bearer ${apiKey}`
        }
    })
    console.log(`deleted ${roomName}`);
}

io.on("connection", (socket) => {
    socket.on("enter", ({eventId, eventName}) => {
        socket.data.eventId = eventId;

        events[eventId] ??={
            roomId: null,
            name: eventName?.trim() || eventId,
        }

        io.emit("events-update", serializeEvents());
    });

    socket.on("start-call", async ({eventId}) => {
        const event = events[eventId];
        if (!event) return;

        leaveCall(socket);

        if (!event.roomId) {
            const dailyRoom = await createRoom();
            if(!dailyRoom) return;
            event.roomId = dailyRoom.url;
            event.roomName = dailyRoom.name;
            event.hostSocketId = socket.id;
        }

        socket.data.inCall = true;
        socket.data.roomId = event.roomId;

        socket.join(event.roomId);

        socket.emit("join-call", {roomId: event.roomId});
        io.emit("events-update", serializeEvents());
    })

    socket.on("join-existing", ({eventId})=>{
        const event = events[eventId];
        if(!event?.roomId) return;

        leaveCall(socket);

        socket.data.inCall = true;
        socket.data.roomId = event.roomId;

        socket.join(event.roomId);

        socket.emit("join-call", {roomId: event.roomId});
        io.emit("events-update", serializeEvents());
    })

    socket.on("disconnect", async () => {
        const {eventId} = socket.data;
        if (!eventId) return;
        const event = events[eventId];

        leaveCall(socket);

        if (event) {
            if (event.hostSocketId === socket.id) {
                io.to(event.roomId).emit("call-ended");
                await deleteRoom(event.roomName);
                delete events[eventId];
            } else if (!hasSockets(eventId)) {
                delete events[eventId];
            }
        }

        io.emit("events-update", serializeEvents());
    })

    socket.on("leave-call", ()=>{
        leaveCall(socket);

        const {eventId} = socket.data;
        if(eventId && !hasSockets(eventId)){
            delete events[eventId];
        }

        socket.emit("left-call");
        io.emit("events-update", serializeEvents());
    })

    socket.on("join-random", ()=>{
        const {eventId} = socket.data;

        const targetEventId = getRandom(eventId);

        if(!targetEventId) {
            socket.emit("no-random-calls");
            return;
        }

        const event = events[targetEventId];
        if(!event?.roomId) return;

        leaveCall(socket);

        socket.data.inCall = true;
        socket.data.roomId = event.roomId;

        socket.join(event.roomId);
        socket.emit("join-call", {roomId: event.roomId});

        io.emit("events-update", serializeEvents());
    })
})

httpServer.listen(3386, ()=>{
    console.log("Server started on port 3386");
});