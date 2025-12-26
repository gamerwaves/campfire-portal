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

function leaveCall(socket){
    const {eventId, roomId} = socket.data;
    if(!eventId||!roomId) return;

    const event = events[eventId];
    if(!event) return;

    event.participants--;

    if(event.participants <= 0){
        event.roomId = null;
        event.participants = 0;
    }

    socket.data.inCall = false;
    socket.data.roomId = null;
}

function serializeEvents(){
    return Object.entries(events).map(([id, e]) => ({
        id,
        inCall: Boolean(e.roomId),
        participants: e.participants
    }))
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

    socket.on("start-call", ({eventId})=>{
        const event = events[eventId];

        if(!event.roomId){
            event.roomId = crypto.randomUUID;
            event.participate = 0;
        }

        leaveCall(socket);

        event.participants++;

        socket.data.inCall = true;
        socket.data.roomId = event.roomId;

        socket.emit("join-call", {roomId:event.roomId});
        io.emit("events-update", serializeEvents());
    });

    socket.on("join-existing", ({eventId})=>{
        const event = events[eventId];
        if(!event?.roomId) return;

        leaveCall(socket);

        event.participants++
        socket.data.inCall = true;
        socket.data.roomId = event.roomId;

        socket.emit("join-call", {roomId:event.roomId});
        io.emit("events-update", serializeEvents());
    })

    socket.on("disconnect", ()=>{
        leaveCall(socket);
        io.emit("events-update", serializeEvents());
    })

    socket.on("leave-call", ()=>{
        leaveCall(socket);
        socket.emit("left-call");
        io.emit("events-update", serializeEvents());
    })
})

httpServer.listen(3386, ()=>{
    console.log("Server started on port 3386");
});