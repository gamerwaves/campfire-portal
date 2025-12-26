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
            id, inCall:Boolean(e.roomId),participants
        }
    });
}

io.on("connection", (socket) => {
    socket.on("enter", ({eventId}) => {
        socket.data.eventId = eventId;

        events[eventId] ??={
            roomId: null,
        }

        io.emit("events-update", serializeEvents());
    });

    socket.on("start-call", ({eventId}) => {
        const event = events[eventId];
        if(!event) return;

        leaveCall(socket);

        if(!event.roomId){
            event.roomId = crypto.randomUUID();
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

    socket.on("disconnect", ()=>{
        const {eventId} = socket.data;

        leaveCall(socket);

        if(eventId && !hasSockets(eventId)){
            delete events[eventId];
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
})

httpServer.listen(3386, ()=>{
    console.log("Server started on port 3386");
});