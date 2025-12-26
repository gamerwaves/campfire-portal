const joinContainer = document.querySelector("#join-container");
const lobbyContainer = document.querySelector("#lobby-container");
const eventsList = document.querySelector("#events");

const join = document.getElementById("join");
const campfireName = document.getElementById("event");

let socket;
let currentEvent;

let inCall = false;
let currentRoom = null;

function slugify(string){
    return string.toLowerCase().replace(/\s/g, "-");
}

function unslugify(string){
    return string.replace(/-/g, " ");
}

function renderEvents(events){
    eventsList.innerHTML = "";

    for(let e of events){
        const li = document.createElement("li");

        li.innerHTML = `
        <b>${unslugify(e.id)}</b> - ${e.inCall ? `(${e.participants})`: "Idle"}
        <button data-join data-events="${e.id}" ${(!e.inCall || inCall)?"disabled":""}>Join call</button>`;

        li.querySelector("[data-join]").onclick = (ev) => {
            const targetEvent = ev.target.dataset.event;
            socket.emit("join-existing", {
                eventId:targetEvent
            })
        }
        eventsList.appendChild(li);
    }

    start.disabled = inCall;
}

join.onclick = () =>{
    const name = campfireName.value.trim();
    if(!name) return alert("Enter Campfire name");

    currentEvent = slugify(campfireName.value.trim());
    socket = io("http://localhost:3386");

    socket.emit("enter", {eventId: currentEvent});

    socket.on("events-update", renderEvents);
    socket.on("join-call", ({roomId}) =>{
        inCall=true;
        currentRoom=roomId;
        leave.hidden = false;
        console.log(`joined ${roomId}`)
    })

    socket.on("left-call", () =>{
        inCall=false;
        currentRoom=null;
        leave.hidden = true;
        console.log(`left call`);
    });

    joinContainer.hidden = true;
    lobbyContainer.hidden = false;
}

const leave = document.getElementById("leave");
const start = document.getElementById("start-call");

leave.onclick = () =>{
    socket.emit("leave-call");
}

start.onclick = () =>{
    if(inCall) return;
    socket.emit("start-call");
}