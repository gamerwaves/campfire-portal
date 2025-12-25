import express from "express";
import {createServer} from "http";
import {Server} from "socket.io";
import crypto from "crypto"

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer,{
    cors: {origin: "*"}
});

const events = {};
const waiting = {};

function serializeEvents(){
    return Object.entries(events).map(([id,e])=>({
        id,
        online:e.users.size,
        waiting:waiting[id]?.size ?? 0
    }));
}

io.on("connection", (socket) => {
    socket.on("enter", ({eventId}) => {
        socket.data.eventId = eventId;

        events[eventId] ??={
            roomId: null,
            participants: 0
        }

        io.emit("events-update", serializeEvents());
    });

    socket.on("start-call", ()=>{
        const {eventId} = socket.data;
        const event = events[eventId];

        if(!event.roomId){
            event.roomId = crypto.randomUUID();
        }

        event.participants++;
        socket.emit("events-update", serializeEvents());
    });

    socket.on("join-existing", ()=>{
        const {eventId} = socket.data;
        const event = events[eventId];

        if(!event.roomId){return}

        event.participants++;
        socket.emit("join-call", {roomId:event.roomId});
        io.emit("events-update", serializeEvents());
    })

    socket.on("disconnect", ()=>{
        const {eventId} = socket.data || {};
        if(!eventId || !events[eventId]){return}

        const event = events[eventId];

        if(event.participants > 0){
            event.participants--;
        }

        if(event.participants === 0){
            event.roomId = null;
        }

        io.emit("events-update", serializeEvents());
    })
})

httpServer.listen(3386, ()=>{
    console.log("Server started on port 3386");
});