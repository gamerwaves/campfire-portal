const joinContainer = document.querySelector("#join-container");
const lobbyContainer = document.querySelector("#lobby-container");
const eventsList = document.querySelector("#events");

const random = document.getElementById("random");
const join = document.getElementById("join");
const campfireName = document.getElementById("event");


let socket;
let currentEvent;

let inCall = false;
let currentRoom = null;
let callFrame = null;


function joinEvent(){
    document.getElementById("title").style.display = "none";
    const name = campfireName.value.trim();
    currentEvent = slugify(name);
    if(!name) return alert("Enter Campfire name");

    currentEvent = slugify(campfireName.value.trim());
    socket = io("https://mackerel-moved-elephant.ngrok-free.app", {
        transports:["websocket", "polling"]
    });

    socket.emit("enter", {eventId: currentEvent, eventName: name});

    socket.on("events-update", renderEvents);
    socket.on("join-call", ({roomId})=>{
        document.getElementById("video-container-container").style.display = "block";
        document.getElementById("container").style.display = "none";
        inCall = true;
        currentRoom = roomId;
        leave.hidden = false;

        if(callFrame){
            callFrame.destroy();
        }

        callFrame = DailyIframe.createFrame(
            document.getElementById("video-container"),{
                showLeaveButton: false,
                iframeStyle:{
                    width: "100%",
                    height: "100%",
                    border: "0"
                }
            }
        )
        callFrame.join({url:roomId,
            userName: `Campfire ${name}`,});
        console.log(`joined ${roomId}`)
    })

    socket.on("left-call", () =>{
        inCall = false;
        currentRoom = null;
        leave.hidden = true;
        document.getElementById("video-container-container").style.display = "none";

        document.getElementById("container").style.display = "flex";

        if(callFrame){
            callFrame.destroy();
            callFrame = null;
        }

        console.log("left call");
    });

    socket.on("call-ended", ()=>{
        inCall = false;
        currentRoom = null;
        leave.hidden = true;

        document.getElementById("video-container-container").style.display = "none";
        document.getElementById("container").style.display = "flex";

        if(callFrame){
            callFrame.destroy();
            callFrame = null;
        }

        alert("The host has left the call")
    })


    socket.on("no-random-calls", ()=>{
        alert("No Campfires active right now - try starting one!");
    })

    joinContainer.hidden = true;
    lobbyContainer.hidden = false;
}

function slugify(string){
    return string.toLowerCase().replace(/\s/g, "-");
}

function renderEvents(events){
    eventsList.innerHTML = "";

    for(let e of events){
        const li = document.createElement("li");

        li.innerHTML = `
        <b>Campfire ${e.name}</b> - ${e.inCall ? `(${e.participants})`: "Idle"}
        <button data-join data-event="${e.id}" ${(!e.inCall || inCall || (e.id === currentEvent))?"disabled":""}>Join call</button>`;

        li.querySelector("[data-join]").onclick = (ev) => {
            const targetEvent = ev.target.dataset.event;
            socket.emit("join-existing", {
                eventId:ev.target.dataset.event
            });
        }
        eventsList.appendChild(li);

        if(e.id === currentEvent){
            li.style.color = "var(--muted)";
            li.innerHTML += " (you)"
        }
    }

    start.disabled = inCall;
    random.disabled = inCall;
}

join.onclick = () =>{
    joinEvent();
}

const leave = document.getElementById("leave");
const start = document.getElementById("start-call");

leave.onclick = () =>{
    socket.emit("leave-call");
}

start.onclick = () =>{
    if(inCall) return;
    socket.emit("start-call", {eventId:currentEvent});
}

random.onclick = () =>{
    if(inCall) return;
    socket.emit("join-random");
}

campfireName.addEventListener("focus", () =>{
    document.addEventListener("keydown", e => {
        if(e.key==="Enter"){
            joinEvent()
        }
    })
})