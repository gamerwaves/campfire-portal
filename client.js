async function getToken(){
    const response = await fetch("/get-token");
    const data = await response.json();
    return data.token;
}

async function joinRoom(){
    const token = await getToken();
    const url = "ws://localhost:7880";

    try{
        const room = await LiveKit.connect(url,token);
        console.log(`connected to ${room.name}`);

        room.participants.forEach(participant => {
            console.log()
        })
    }
}