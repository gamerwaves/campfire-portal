import express from "express";
import {createServer} from "http";
import {Server} from "socket.io";
import crypto from "crypto"
import "dotenv/config";

const app = express();
app.use(express.static('.'));
const httpServer = createServer(app);

const origins = ["https://astra-the-boop.github.io", "http://localhost", "http://localhost:3386", "http://dwait.local:3386"]

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

// Generate a unique room name for Jitsi
function generateRoomName() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(12).toString('hex');
    return `CampfirePortal${timestamp}${random}`;
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

io.on("connection", (socket) => {
    socket.on("enter", ({eventId, eventName}) => {
        socket.data.eventId = eventId;
        socket.data.userName = eventName?.trim() || eventId;

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
            // Generate a unique room name
            const roomName = generateRoomName();
            event.roomId = roomName;
            event.hostSocketId = socket.id;
            console.log(`Created new room: ${roomName} for event: ${eventId}`);
        }

        socket.data.inCall = true;
        socket.data.roomId = event.roomId;

        // Get existing users in the room with their names
        const room = io.sockets.adapter.rooms.get(event.roomId);
        const existingUsers = room ? Array.from(room).filter(id => id !== socket.id).map(id => {
            const userSocket = io.sockets.sockets.get(id);
            return {
                userId: id,
                userName: userSocket?.data?.userName || 'Unknown'
            };
        }) : [];
        console.log(`User ${socket.id} joining room ${event.roomId}, existing users: ${existingUsers.length}`);

        socket.join(event.roomId);

        // Notify existing users in the room about new user
        socket.to(event.roomId).emit("user-joined", {
            userId: socket.id, 
            userName: socket.data.userName
        });

        socket.emit("join-call", {roomId: event.roomId, existingUsers});
        io.emit("events-update", serializeEvents());
    })

    socket.on("join-existing", ({eventId}) => {
        const event = events[eventId];
        if(!event?.roomId) return;

        leaveCall(socket);

        socket.data.inCall = true;
        socket.data.roomId = event.roomId;

        // Get existing users in the room with their names
        const room = io.sockets.adapter.rooms.get(event.roomId);
        const existingUsers = room ? Array.from(room).filter(id => id !== socket.id).map(id => {
            const userSocket = io.sockets.sockets.get(id);
            return {
                userId: id,
                userName: userSocket?.data?.userName || 'Unknown'
            };
        }) : [];
        console.log(`User ${socket.id} joining existing room ${event.roomId}, existing users: ${existingUsers.length}`);

        socket.join(event.roomId);

        // Notify existing users in the room about new user
        socket.to(event.roomId).emit("user-joined", {
            userId: socket.id, 
            userName: socket.data.userName
        });

        socket.emit("join-call", {roomId: event.roomId, existingUsers});
        io.emit("events-update", serializeEvents());
    })

    // WebRTC signaling
    socket.on("webrtc-offer", ({offer, to}) => {
        socket.to(to).emit("webrtc-offer", {
            offer, 
            from: socket.id, 
            fromUserName: socket.data.userName
        });
    });

    socket.on("webrtc-answer", ({answer, to}) => {
        socket.to(to).emit("webrtc-answer", {
            answer, 
            from: socket.id, 
            fromUserName: socket.data.userName
        });
    });

    socket.on("webrtc-ice-candidate", ({candidate, to}) => {
        socket.to(to).emit("webrtc-ice-candidate", {candidate, from: socket.id});
    });

    socket.on("disconnect", async () => {
        const {eventId, roomId} = socket.data;
        if (!eventId) return;
        const event = events[eventId];

        // Notify other users in the room that this user left
        if (roomId) {
            socket.to(roomId).emit("user-left", {userId: socket.id});
        }

        leaveCall(socket);

        if (event) {
            if (event.hostSocketId === socket.id) {
                io.to(event.roomId).emit("call-ended");
                delete events[eventId];
            } else if (!hasSockets(eventId)) {
                delete events[eventId];
            }
        }

        io.emit("events-update", serializeEvents());
    })

    socket.on("leave-call", () => {
        const {roomId} = socket.data;
        
        // Notify other users in the room that this user left
        if (roomId) {
            socket.to(roomId).emit("user-left", {userId: socket.id});
        }
        
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

        // Get existing users in the room with their names
        const room = io.sockets.adapter.rooms.get(event.roomId);
        const existingUsers = room ? Array.from(room).filter(id => id !== socket.id).map(id => {
            const userSocket = io.sockets.sockets.get(id);
            return {
                userId: id,
                userName: userSocket?.data?.userName || 'Unknown'
            };
        }) : [];

        socket.join(event.roomId);
        
        // Notify existing users in the room about new user
        socket.to(event.roomId).emit("user-joined", {
            userId: socket.id, 
            userName: socket.data.userName
        });
        
        socket.emit("join-call", {roomId: event.roomId, existingUsers});

        io.emit("events-update", serializeEvents());
    })
})

httpServer.listen(3386, ()=>{
    console.log("Server started on port 3386");
});