const joinContainer = document.querySelector("#join-container");
const lobbyContainer = document.querySelector("#lobby-container");
const eventsList = document.querySelector("#events");

const join = document.getElementById("join");
const campfireName = document.getElementById("event");

let socket;
let currentEvent;

function slugify(string){
    return string.toLowerCase().replace(/\s/g, "-");
}

function unslugify(string){
    return string.replace(/-/g, " ");
}

function renderEvents(events){
    eventsList.innerHTML = '';

    for(let e of events){
        const li = document.createElement("li");

        li.innerHTML = `
        <b>${unslugify(e.id)}</b> - ${e.inCall ? "In call" : "Waiting"} <button ${e.inCall ? "" : "disabled"}></button>`

    }
}

join.onclick = () =>{
    const campfireName = campfireName.value.trim();
    if(!campfireName) return alert("Enter Campfire name");

    currentEvent = slugify(campfireName);
    socket = io("https://localhost:3386");

    socket.emit("enter", {eventId: currentEvent});

    joinContainer.hidden = true;
    lobbyContainer.hidden = false;

    socket.on("events-update", renderEvents);
    socket.on("join-call", ({roomId})=>{
        alert(`joined call ${roomId}`);
    })
}