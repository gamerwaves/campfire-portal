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
let localStream = null;
let peerConnections = {};
let isAudioEnabled = false; // Start with audio muted
let isVideoEnabled = true; // Start with video enabled
let selectedCameraId = null; // Track selected camera

// Audio analysis for waveforms
let audioContext = null;
let localAnalyser = null;
let remoteAnalysers = {};
let waveformAnimations = {};

const localVideo = document.getElementById('localVideo');
const remoteVideos = document.getElementById('remoteVideos');
const toggleAudio = document.getElementById('toggleAudio');
const toggleVideo = document.getElementById('toggleVideo');

// WebRTC configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Audio waveform functions
function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function createWaveform(containerId, isLocal = false) {
    // Create a wrapper div for the waveform
    const waveformId = isLocal ? 'local-video' : containerId.replace('remote-container-', '');
    const waveformDiv = document.createElement('div');
    waveformDiv.id = `waveform-${waveformId}`;
    waveformDiv.style.position = 'absolute';
    waveformDiv.style.top = '8px';
    waveformDiv.style.right = '8px';
    waveformDiv.style.width = '100px';
    waveformDiv.style.height = '30px';
    waveformDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    waveformDiv.style.borderRadius = '4px';
    waveformDiv.style.zIndex = '11';
    waveformDiv.style.padding = '2px';
    waveformDiv.style.boxSizing = 'border-box';
    
    // Create the canvas inside the div
    const canvas = document.createElement('canvas');
    canvas.width = 96; // Slightly smaller to account for padding
    canvas.height = 26;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.borderRadius = '2px';
    
    waveformDiv.appendChild(canvas);
    
    const container = document.getElementById(containerId);
    if (container) {
        container.appendChild(waveformDiv);
    }
    
    return canvas;
}

function setupLocalAudioAnalysis() {
    if (!localStream || !audioContext) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;
    
    try {
        const source = audioContext.createMediaStreamSource(localStream);
        localAnalyser = audioContext.createAnalyser();
        localAnalyser.fftSize = 256;
        source.connect(localAnalyser);
        
        const canvas = createWaveform('local-video-container', true);
        if (canvas) {
            startWaveformAnimation(canvas, localAnalyser, 'local');
        }
    } catch (error) {
        console.error('Error setting up local audio analysis:', error);
    }
}

function setupRemoteAudioAnalysis(userId, stream) {
    if (!audioContext) return;
    
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;
    
    try {
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        
        remoteAnalysers[userId] = analyser;
        
        const canvas = createWaveform(`remote-container-${userId}`);
        if (canvas) {
            startWaveformAnimation(canvas, analyser, userId);
        }
    } catch (error) {
        console.error(`Error setting up remote audio analysis for ${userId}:`, error);
    }
}

function startWaveformAnimation(canvas, analyser, id) {
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function animate() {
        if (!waveformAnimations[id]) return;
        
        requestAnimationFrame(animate);
        
        analyser.getByteFrequencyData(dataArray);
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = canvas.width / bufferLength * 2;
        let x = 0;
        
        // Calculate average volume for color intensity
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const intensity = Math.min(average / 128, 1);
        
        // Draw waveform bars
        for (let i = 0; i < bufferLength; i += 2) {
            const barHeight = (dataArray[i] / 255) * canvas.height;
            
            // Color based on intensity - green to red
            const red = Math.floor(intensity * 255);
            const green = Math.floor((1 - intensity) * 255);
            ctx.fillStyle = `rgb(${red}, ${green}, 50)`;
            
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }
    
    waveformAnimations[id] = true;
    animate();
}

function stopWaveformAnimation(id) {
    waveformAnimations[id] = false;
    delete waveformAnimations[id];
    
    if (id !== 'local') {
        delete remoteAnalysers[id];
    }
    
    // Remove the waveform div - handle local vs remote ID mapping
    const waveformId = id === 'local' ? 'local-video' : id;
    const waveformDiv = document.getElementById(`waveform-${waveformId}`);
    if (waveformDiv) {
        waveformDiv.remove();
    }
}

function joinEvent(){
    document.getElementById("title").style.display = "none";
    const name = campfireName.value.trim();
    currentEvent = slugify(name);
    if(!name) return alert("Enter Campfire name");

    currentEvent = slugify(campfireName.value.trim());
    socket = io("https://campfire-portal-socket.vercel.app", {
        transports:["websocket", "polling"]
    });

    socket.emit("enter", {eventId: currentEvent, eventName: name});

    socket.on("events-update", renderEvents);
    
    socket.on("join-call", async ({roomId, existingUsers}) => {
        document.getElementById("video-container-container").style.display = "block";
        document.getElementById("container").style.display = "none";
        inCall = true;
        currentRoom = roomId;
        leave.hidden = false;

        // Set local user's city name
        const localNameLabel = document.getElementById('local-name-label');
        if (localNameLabel) {
            localNameLabel.textContent = campfireName.value.trim() || 'You';
        }

        await startLocalVideo();
        
        // Small delay to ensure local stream is ready
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Create offers to existing users in the room
        if (existingUsers && existingUsers.length > 0) {
            console.log(`Creating offers to ${existingUsers.length} existing users:`, existingUsers);
            for (const user of existingUsers) {
                await createOfferToPeer(user.userId, user.userName);
            }
        }
        
        console.log(`joined ${roomId}`)
    });

    // WebRTC signaling events
    socket.on("webrtc-offer", async ({offer, from, fromUserName}) => {
        await handleOffer(offer, from, fromUserName);
    });

    socket.on("webrtc-answer", async ({answer, from, fromUserName}) => {
        await handleAnswer(answer, from);
    });

    socket.on("webrtc-ice-candidate", async ({candidate, from}) => {
        await handleIceCandidate(candidate, from);
    });

    socket.on("user-joined", async ({userId, userName}) => {
        console.log(`User joined: ${userId} (${userName}), creating offer...`);
        // Small delay to ensure both users have their streams ready
        await new Promise(resolve => setTimeout(resolve, 500));
        await createOfferToPeer(userId, userName);
    });

    socket.on("user-left", ({userId}) => {
        removePeerConnection(userId);
    });

    socket.on("left-call", () => {
        inCall = false;
        currentRoom = null;
        leave.hidden = true;
        document.getElementById("video-container-container").style.display = "none";
        document.getElementById("container").style.display = "flex";

        stopLocalVideo();
        closeAllConnections();
        console.log("left call");
    });

    socket.on("call-ended", () => {
        inCall = false;
        currentRoom = null;
        leave.hidden = true;

        document.getElementById("video-container-container").style.display = "none";
        document.getElementById("container").style.display = "flex";

        stopLocalVideo();
        closeAllConnections();
        alert("The host has left the call")
    });

    socket.on("no-random-calls", () => {
        alert("No Campfires active right now - try starting one!");
    });

    joinContainer.hidden = true;
    lobbyContainer.hidden = false;
}

async function getAvailableCameras() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(device => device.kind === 'videoinput');
        return cameras;
    } catch (error) {
        console.error('Error getting available cameras:', error);
        return [];
    }
}

async function startLocalVideo() {
    try {
        const constraints = {
            audio: true,
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };
        
        // If a camera is selected, use it
        if (selectedCameraId) {
            constraints.video.deviceId = { exact: selectedCameraId };
        }
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Start with audio disabled but video enabled so people can see each other
        localStream.getAudioTracks().forEach(track => track.enabled = false);
        localStream.getVideoTracks().forEach(track => track.enabled = true);
        
        // Update the UI state
        isAudioEnabled = false;
        isVideoEnabled = true;
        toggleAudio.classList.add('disabled');
        toggleVideo.classList.remove('disabled');
        
        localVideo.srcObject = localStream;
        
        // Initialize audio context and setup local waveform
        initAudioContext();
        setupLocalAudioAnalysis();
        
        console.log('Local video started, video enabled:', isVideoEnabled);
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Could not access camera/microphone. Please check permissions.');
    }
}

function stopLocalVideo() {
    if (localStream) {
        // Stop all tracks to properly disconnect camera
        localStream.getTracks().forEach(track => {
            track.stop();
        });
        localStream = null;
        localVideo.srcObject = null;
    }
    
    // Stop local waveform animation
    stopWaveformAnimation('local');
    localAnalyser = null;
}

function createPeerConnection(userId, userName = 'Unknown') {
    console.log(`Creating peer connection for: ${userId} (${userName})`);
    const peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnections[userId] = peerConnection;

    // Add local stream to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log(`Adding local track to peer ${userId}: ${track.kind}, enabled: ${track.enabled}`);
            peerConnection.addTrack(track, localStream);
        });
    }

    // Handle remote stream
    peerConnection.ontrack = (event) => {
        console.log(`Received remote stream from: ${userId} (${userName})`, event);
        const remoteStream = event.streams[0];
        addRemoteVideo(userId, userName, remoteStream);
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("webrtc-ice-candidate", {
                candidate: event.candidate,
                to: userId
            });
        }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state with ${userId} (${userName}): ${peerConnection.connectionState}`);
    };

    return peerConnection;
}

async function createOfferToPeer(userId, userName = 'Unknown') {
    console.log(`Creating offer to peer: ${userId} (${userName})`);
    const peerConnection = createPeerConnection(userId, userName);
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit("webrtc-offer", {
        offer: offer,
        to: userId
    });
}

async function handleOffer(offer, from, fromUserName = 'Unknown') {
    console.log(`Received offer from: ${from} (${fromUserName})`);
    const peerConnection = createPeerConnection(from, fromUserName);
    
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    console.log(`Sending answer to: ${from} (${fromUserName})`);
    socket.emit("webrtc-answer", {
        answer: answer,
        to: from
    });
}

async function handleAnswer(answer, from) {
    console.log(`Received answer from: ${from}`);
    const peerConnection = peerConnections[from];
    if (peerConnection) {
        await peerConnection.setRemoteDescription(answer);
    }
}

async function handleIceCandidate(candidate, from) {
    console.log(`Received ICE candidate from: ${from}`);
    const peerConnection = peerConnections[from];
    if (peerConnection) {
        await peerConnection.addIceCandidate(candidate);
    }
}

function addRemoteVideo(userId, userName, stream) {
    console.log(`Adding remote video for user: ${userId} (${userName})`, stream);
    let remoteVideoContainer = document.getElementById(`remote-container-${userId}`);
    
    if (!remoteVideoContainer) {
        // Create container for video and label
        remoteVideoContainer = document.createElement('div');
        remoteVideoContainer.id = `remote-container-${userId}`;
        remoteVideoContainer.style.position = 'relative';
        remoteVideoContainer.style.display = 'inline-block';
        remoteVideoContainer.style.margin = '10px';
        
        // Create video element
        const remoteVideo = document.createElement('video');
        remoteVideo.id = `remote-${userId}`;
        remoteVideo.autoplay = true;
        remoteVideo.playsinline = true;
        remoteVideo.style.width = '300px';
        remoteVideo.style.height = '200px';
        remoteVideo.style.border = '2px solid #fff';
        remoteVideo.style.borderRadius = '8px';
        
        // Create label for city name
        const nameLabel = document.createElement('div');
        nameLabel.id = `name-${userId}`;
        nameLabel.textContent = userName;
        nameLabel.style.position = 'absolute';
        nameLabel.style.bottom = '8px';
        nameLabel.style.left = '8px';
        nameLabel.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        nameLabel.style.color = 'white';
        nameLabel.style.padding = '4px 8px';
        nameLabel.style.borderRadius = '4px';
        nameLabel.style.fontSize = '14px';
        nameLabel.style.fontWeight = 'bold';
        nameLabel.style.zIndex = '10';
        
        remoteVideoContainer.appendChild(remoteVideo);
        remoteVideoContainer.appendChild(nameLabel);
        remoteVideos.appendChild(remoteVideoContainer);
        
        console.log(`Created new video element for user: ${userId} (${userName})`);
    }
    
    const remoteVideo = document.getElementById(`remote-${userId}`);
    remoteVideo.srcObject = stream;
    
    // Setup audio waveform for this remote user
    setupRemoteAudioAnalysis(userId, stream);
    
    // Log track information
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();
    console.log(`Remote stream tracks - Video: ${videoTracks.length}, Audio: ${audioTracks.length}`);
    videoTracks.forEach((track, index) => {
        console.log(`Video track ${index}: enabled=${track.enabled}, readyState=${track.readyState}`);
    });
}

function removePeerConnection(userId) {
    if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
    }
    
    // Stop waveform animation for this user
    stopWaveformAnimation(userId);
    
    const remoteVideoContainer = document.getElementById(`remote-container-${userId}`);
    if (remoteVideoContainer) {
        remoteVideoContainer.remove();
    }
}

function closeAllConnections() {
    Object.keys(peerConnections).forEach(userId => {
        removePeerConnection(userId);
    });
    remoteVideos.innerHTML = '';
    
    // Clear all waveform animations
    Object.keys(waveformAnimations).forEach(id => {
        stopWaveformAnimation(id);
    });
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
            socket.emit("join-existing", {
                eventId: ev.target.dataset.event
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

join.onclick = () => {
    joinEvent();
}

const leave = document.getElementById("leave");
const start = document.getElementById("start-call");

leave.onclick = () => {
    stopLocalVideo();
    closeAllConnections();
    socket.emit("leave-call");
}

start.onclick = async () => {
    if(inCall) return;
    socket.emit("start-call", {eventId: currentEvent});
}

random.onclick = () => {
    if(inCall) return;
    socket.emit("join-random");
}

// Media controls
toggleAudio.onclick = () => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            isAudioEnabled = audioTrack.enabled;
            
            if (isAudioEnabled) {
                toggleAudio.classList.remove('disabled');
                // Resume audio context if needed
                if (audioContext && audioContext.state === 'suspended') {
                    audioContext.resume();
                }
            } else {
                toggleAudio.classList.add('disabled');
            }
        }
    }
}

toggleVideo.onclick = async () => {
    if (!localStream) return;
    
    if (isVideoEnabled) {
        // Turning OFF - stop the video track completely
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.stop();
            localStream.removeTrack(videoTrack);
        }
        localVideo.srcObject = null;
        isVideoEnabled = false;
        toggleVideo.classList.add('disabled');
        console.log('Video turned OFF');
    } else {
        // Turning ON - restart the video stream
        try {
            const constraints = {
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false // Don't get audio again
            };
            
            if (selectedCameraId) {
                constraints.video.deviceId = { exact: selectedCameraId };
            }
            
            const videoStream = await navigator.mediaDevices.getUserMedia(constraints);
            const newVideoTrack = videoStream.getVideoTracks()[0];
            
            // Stop any audio tracks from the new stream
            videoStream.getAudioTracks().forEach(track => track.stop());
            
            // Add the new video track to the stream
            localStream.addTrack(newVideoTrack);
            localVideo.srcObject = localStream;
            
            // Update peer connections with new track
            Object.values(peerConnections).forEach(peerConnection => {
                const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(newVideoTrack);
                }
            });
            
            isVideoEnabled = true;
            toggleVideo.classList.remove('disabled');
            console.log('Video turned ON');
        } catch (error) {
            console.error('Error restarting video:', error);
            alert('Could not restart camera. Please check permissions.');
        }
    }
}

campfireName.addEventListener("focus", () => {
    document.addEventListener("keydown", e => {
        if(e.key==="Enter"){
            joinEvent()
        }
    })
})

// Camera source picker
const cameraSelect = document.getElementById('cameraSelect');

async function populateCameraOptions() {
    const cameras = await getAvailableCameras();
    cameraSelect.innerHTML = '<option value="">Select Camera</option>';
    
    cameras.forEach((camera, index) => {
        const option = document.createElement('option');
        option.value = camera.deviceId;
        option.textContent = camera.label || `Camera ${index + 1}`;
        cameraSelect.appendChild(option);
    });
    
    // Select first camera by default
    if (cameras.length > 0) {
        selectedCameraId = cameras[0].deviceId;
        cameraSelect.value = selectedCameraId;
    }
}

cameraSelect.addEventListener('change', async (e) => {
    selectedCameraId = e.target.value;
    
    // Only switch camera if video is currently enabled and in a call
    if (inCall && localStream && isVideoEnabled) {
        try {
            // Stop current video track
            const currentVideoTrack = localStream.getVideoTracks()[0];
            if (currentVideoTrack) {
                currentVideoTrack.stop();
                localStream.removeTrack(currentVideoTrack);
            }
            
            // Get new video stream from selected camera
            const constraints = {
                video: {
                    deviceId: { exact: selectedCameraId },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false // Don't get audio again
            };
            
            const videoStream = await navigator.mediaDevices.getUserMedia(constraints);
            const newVideoTrack = videoStream.getVideoTracks()[0];
            
            // Stop any audio tracks from the new stream
            videoStream.getAudioTracks().forEach(track => track.stop());
            
            // Add new track to stream
            localStream.addTrack(newVideoTrack);
            localVideo.srcObject = localStream;
            
            // Update all peer connections with new track
            Object.values(peerConnections).forEach(peerConnection => {
                const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(newVideoTrack);
                }
            });
            
            console.log('Camera switched successfully');
        } catch (error) {
            console.error('Error switching camera:', error);
            alert('Could not switch camera. Please try again.');
        }
    }
});

// Populate cameras when page loads
navigator.mediaDevices.addEventListener('devicechange', populateCameraOptions);
populateCameraOptions();