const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const CHUNK_SIZE = 64 * 1024;

const peers = new Map();
const incomingTransfers = new Map();

let signalingSocket;
let myPeerId = null;
let myDeviceName = localStorage.getItem("saved_name") || `Device-${Math.random().toString(36).slice(2, 6)}`;
let selectedDeviceId = null;

const roomId = getRoomId();
const SIGNALING_URL = resolveSignalingUrl();

function resolveSignalingUrl() {
    const { protocol, hostname, host } = window.location;
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";

    const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
    if (localHosts.has(hostname)) {
        return `${wsProtocol}//localhost:8787/ws`;
    }

    return `${wsProtocol}//${host}/ws`;
}

function getRoomId() {
    const existingHash = location.hash.replace("#", "").trim();
    if (existingHash) return existingHash;
    const generated = Math.random().toString(36).slice(2, 8).toUpperCase();
    location.hash = generated;
    return generated;
}

function updateConnectionStatus(message, isError = false) {
    const status = document.getElementById("connectionStatus");
    status.textContent = message;
    status.style.color = isError ? "#e53935" : "";
}

function updateRoomInfo() {
    const roomInfo = document.getElementById("roomInfo");
    roomInfo.innerHTML = `Room ID: <strong>${roomId}</strong> · Share this URL to connect devices.`;
}

function createPeerConnection(peerId, peerName, shouldCreateChannel) {
    if (peers.has(peerId)) return peers.get(peerId);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peerData = { id: peerId, name: peerName || peerId, pc, dc: null, connected: false };

    pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        sendSignal({ type: "candidate", target: peerId, candidate: event.candidate });
    };

    pc.onconnectionstatechange = () => {
        if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
            peerData.connected = false;
            renderDevices();
        }
    };

    pc.ondatachannel = (event) => attachDataChannel(peerId, event.channel);

    if (shouldCreateChannel) {
        attachDataChannel(peerId, pc.createDataChannel("airlink", { ordered: true }));
    }

    peers.set(peerId, peerData);
    renderDevices();
    return peerData;
}

function attachDataChannel(peerId, dc) {
    const peer = peers.get(peerId);
    if (!peer) return;

    peer.dc = dc;
    dc.binaryType = "arraybuffer";

    dc.onopen = () => {
        peer.connected = true;
        updateConnectionStatus("Peer connection active.");
        renderDevices();
    };
    dc.onclose = () => {
        peer.connected = false;
        renderDevices();
    };
    dc.onerror = () => updateConnectionStatus(`Data channel error with ${peer.name}.`, true);
    dc.onmessage = (event) => handleDataMessage(peerId, event.data);
}

async function startOffer(peerId, peerName) {
    const peer = createPeerConnection(peerId, peerName, true);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    sendSignal({ type: "offer", target: peerId, sdp: offer });
}

async function handleOffer(fromPeerId, fromPeerName, sdp) {
    const peer = createPeerConnection(fromPeerId, fromPeerName, false);
    await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    sendSignal({ type: "answer", target: fromPeerId, sdp: answer });
}

async function handleAnswer(fromPeerId, sdp) {
    const peer = peers.get(fromPeerId);
    if (!peer) return;
    await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

async function handleCandidate(fromPeerId, candidate) {
    const peer = peers.get(fromPeerId);
    if (!peer) return;
    try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
        updateConnectionStatus("Failed to add ICE candidate.", true);
    }
}

function connectSignaling() {
    signalingSocket = new WebSocket(`${SIGNALING_URL}?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(myDeviceName)}`);

    signalingSocket.onopen = () => updateConnectionStatus("Connected to signaling service.");
    signalingSocket.onclose = () => updateConnectionStatus("Disconnected from signaling service.", true);
    signalingSocket.onerror = () => updateConnectionStatus("Signaling connection error.", true);

    signalingSocket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
            case "welcome":
                myPeerId = msg.peerId;
                updateRoomInfo();
                break;
            case "peer-joined":
                if (msg.peerId !== myPeerId) await startOffer(msg.peerId, msg.name);
                break;
            case "peer-left":
                closePeer(msg.peerId);
                break;
            case "signal":
                await routeSignal(msg.from, msg.name, msg.payload);
                break;
            default:
                break;
        }
    };
}

async function routeSignal(fromPeerId, fromPeerName, payload) {
    if (!payload?.type) return;
    if (payload.type === "offer") return handleOffer(fromPeerId, fromPeerName, payload.sdp);
    if (payload.type === "answer") return handleAnswer(fromPeerId, payload.sdp);
    if (payload.type === "candidate") return handleCandidate(fromPeerId, payload.candidate);
}

function sendSignal(payload) {
    if (!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) return;
    signalingSocket.send(JSON.stringify({ type: "signal", payload }));
}

function closePeer(peerId) {
    const peer = peers.get(peerId);
    if (!peer) return;
    try { peer.dc?.close(); } catch {}
    try { peer.pc?.close(); } catch {}
    peers.delete(peerId);
    renderDevices();
}

function renderDevices() {
    const deviceListDiv = document.getElementById("devices");
    deviceListDiv.innerHTML = "";

    const peerList = Array.from(peers.values()).filter((peer) => peer.id !== myPeerId);
    if (peerList.length === 0) {
        const empty = document.createElement("div");
        empty.className = "help";
        empty.textContent = "No devices connected in this room yet.";
        deviceListDiv.appendChild(empty);
        return;
    }

    peerList.forEach((peer) => {
        const deviceDiv = document.createElement("div");
        deviceDiv.classList.add("device");
        deviceDiv.textContent = `${peer.name}${peer.connected ? "" : " (connecting...)"}`;

        deviceDiv.onclick = () => {
            selectedDeviceId = peer.id;
            document.getElementById("fileInput").click();
        };

        deviceDiv.oncontextmenu = (e) => {
            e.preventDefault();
            selectedDeviceId = peer.id;
            showMessageBox();
        };

        deviceDiv.ondragover = (e) => { e.preventDefault(); deviceDiv.classList.add("drag-over"); };
        deviceDiv.ondragleave = () => deviceDiv.classList.remove("drag-over");
        deviceDiv.ondrop = (e) => {
            e.preventDefault();
            deviceDiv.classList.remove("drag-over");
            if (e.dataTransfer.files.length > 0) {
                selectedDeviceId = peer.id;
                sendFile({ files: [e.dataTransfer.files[0]] });
            }
        };

        deviceListDiv.appendChild(deviceDiv);
    });
}

async function sendFile(inputElement) {
    const peer = peers.get(selectedDeviceId);
    if (!peer || !peer.dc || peer.dc.readyState !== "open") return alert("Selected device is not ready yet.");
    if (!inputElement.files.length) return alert("No file selected.");

    const file = inputElement.files[0];
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let sentChunks = 0;
    showProgressBar();

    peer.dc.send(JSON.stringify({ kind: "file-meta", name: file.name, type: file.type, size: file.size, totalChunks }));

    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
        const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
        while (peer.dc.bufferedAmount > CHUNK_SIZE * 8) await new Promise((resolve) => setTimeout(resolve, 20));
        peer.dc.send(chunk);
        sentChunks += 1;
        updateProgressBar((sentChunks / totalChunks) * 100);
    }

    peer.dc.send(JSON.stringify({ kind: "file-complete", name: file.name }));
    updateConnectionStatus(`Sent ${file.name} to ${peer.name}.`);
    setTimeout(hideProgressBar, 500);
}

function handleDataMessage(fromPeerId, payload) {
    if (typeof payload === "string") {
        const msg = JSON.parse(payload);
        if (msg.kind === "chat") return showMessagePopup(`${msg.sender}: ${msg.message}`);

        if (msg.kind === "file-meta") {
            incomingTransfers.set(fromPeerId, { name: msg.name, type: msg.type, totalChunks: msg.totalChunks, receivedChunks: 0, chunks: [] });
            showProgressBar();
            updateConnectionStatus(`Receiving ${msg.name}...`);
            return;
        }

        if (msg.kind === "file-complete") finalizeIncomingFile(fromPeerId);
        return;
    }

    const transfer = incomingTransfers.get(fromPeerId);
    if (!transfer) return;
    transfer.chunks.push(payload);
    transfer.receivedChunks += 1;
    updateProgressBar((transfer.receivedChunks / transfer.totalChunks) * 100);
}

function finalizeIncomingFile(fromPeerId) {
    const transfer = incomingTransfers.get(fromPeerId);
    if (!transfer) return;

    const blob = new Blob(transfer.chunks, { type: transfer.type || "application/octet-stream" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = transfer.name || "received_file";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    incomingTransfers.delete(fromPeerId);
    hideProgressBar();
    updateConnectionStatus(`Received ${transfer.name}.`);
}

function showProgressBar() {
    const container = document.getElementById("progressContainer");
    const bar = document.getElementById("progressBar");
    container.style.display = "block";
    bar.style.width = "0";
}

function updateProgressBar(percentage) {
    document.getElementById("progressBar").style.width = `${Math.min(100, percentage)}%`;
}

function hideProgressBar() {
    document.getElementById("progressContainer").style.display = "none";
}

function sendMessage() {
    const peer = peers.get(selectedDeviceId);
    const messageInput = document.getElementById("messageInput");
    const message = messageInput.value.trim();

    if (!peer || !peer.dc || peer.dc.readyState !== "open" || !message) return alert("Target device or message is missing!");

    peer.dc.send(JSON.stringify({ kind: "chat", sender: myDeviceName, message }));
    messageInput.value = "";
    hideMessageBox();
}

function showMessagePopup(message) {
    const popup = document.getElementById("messagePopup");
    document.getElementById("popupMessage").textContent = message;
    popup.classList.remove("hidden");
    popup.style.display = "block";
}

document.getElementById("closePopup").onclick = () => { document.getElementById("messagePopup").style.display = "none"; };

function showMessageBox() {
    document.getElementById("overlay").style.display = "block";
    document.getElementById("messageBox").style.display = "block";
    document.getElementById("overlay").onclick = () => hideMessageBox();
}

function hideMessageBox() {
    document.getElementById("overlay").style.display = "none";
    document.getElementById("messageBox").style.display = "none";
}

function initNameCard() {
    let nameDiv = document.getElementById("name-container");
    if (!nameDiv) {
        nameDiv = document.createElement("div");
        nameDiv.id = "name-container";
        nameDiv.classList.add("name-container");
        document.body.appendChild(nameDiv);
    }

    nameDiv.innerHTML = `You are known as: <span id="device-name" class="styled-device-name">${myDeviceName}</span>
        <i id="rename-icon" class="fa fa-pencil-alt rename-icon"></i>`;

    document.getElementById("rename-icon").onclick = () => {
        const newName = prompt("Enter a new name for your device:");
        if (!newName) return;
        myDeviceName = newName.trim();
        localStorage.setItem("saved_name", myDeviceName);
        document.getElementById("device-name").textContent = myDeviceName;
        if (signalingSocket?.readyState === WebSocket.OPEN) {
            signalingSocket.close();
            connectSignaling();
        }
    };
}

const changelogSection = document.getElementById("changelogSection");
const changelogContent = document.getElementById("changelogContent");
const changelogToggle = document.getElementById("changelogToggle");
const closeChangelog = document.getElementById("closeChangelog");

changelogSection.style.display = "none";
changelogToggle.addEventListener("click", () => {
    changelogSection.style.display = "block";
    fetch("https://raw.githubusercontent.com/Adityasinh-Sodha/AirLink/refs/heads/main/CHANGELOG.md")
        .then((response) => response.text())
        .then((data) => { changelogContent.innerHTML = data; })
        .catch(() => { changelogContent.innerHTML = "<p>Error loading changelog.</p>"; });
});
closeChangelog.addEventListener("click", () => { changelogSection.style.display = "none"; });

document.getElementById("aboutUsButton").addEventListener("click", (event) => {
    const overlay = document.getElementById("aboutUsOverlay");
    const button = event.target;
    const content = document.getElementById("aboutUsContent");

    if (button.classList.contains("active")) {
        button.classList.remove("active");
        overlay.classList.remove("active");
        setTimeout(() => content.classList.remove("show"), 0);
        return;
    }

    button.classList.add("active");
    const rect = button.getBoundingClientRect();
    overlay.style.left = `${rect.left + rect.width / 2}px`;
    overlay.style.top = `${rect.top + rect.height / 2}px`;
    overlay.classList.add("active");
    setTimeout(() => content.classList.add("show"), 600);
});

const toggleSwitch = document.getElementById("theme-toggle");
if (localStorage.getItem("theme") === "dark") {
    document.body.classList.add("dark-mode");
    toggleSwitch.checked = true;
}

toggleSwitch.addEventListener("change", () => {
    if (toggleSwitch.checked) {
        document.body.classList.add("dark-mode");
        localStorage.setItem("theme", "dark");
    } else {
        document.body.classList.remove("dark-mode");
        localStorage.setItem("theme", "light");
    }
});

updateRoomInfo();
initNameCard();
connectSignaling();

window.sendFile = sendFile;
window.sendMessage = sendMessage;
window.showMessageBox = showMessageBox;
window.hideMessageBox = hideMessageBox;
