const RECORDING_MS = 10000;

let microphoneStream = null;
let systemAudioStream = null;
let displayStreamForSession = null;
let mixedStream = null;
let mediaRecorder = null;
let mixAudioContext = null;
let chunks = [];
let stopTimer = null;
let objectUrl = null;
let recordingInProgress = false;
let shouldStartPlayback = true;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const micSelect = document.getElementById('micSelect');
const captureStatus = document.getElementById('captureStatus');
const playbackStatus = document.getElementById('playbackStatus');
const logOutput = document.getElementById('logOutput');
const loopPlayer = document.getElementById('loopPlayer');

function log(message) {
    const timestamp = new Date().toLocaleTimeString();
    logOutput.textContent += `[${timestamp}] ${message}\n`;
    logOutput.scrollTop = logOutput.scrollHeight;
    window.electronAPI?.log?.(message).catch(() => {});
}

function setCaptureStatus(text, connected) {
    captureStatus.textContent = text;
    captureStatus.className = `status ${connected ? 'connected' : 'disconnected'}`;
}

function setPlaybackStatus(text, connected) {
    playbackStatus.textContent = text;
    playbackStatus.className = `status ${connected ? 'connected' : 'disconnected'}`;
}

async function updateMicSelect() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === 'audioinput');

    micSelect.innerHTML = '';
    if (audioInputs.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No microphone found';
        micSelect.appendChild(option);
        micSelect.disabled = true;
        return;
    }

    micSelect.disabled = false;
    audioInputs.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${index + 1}`;
        micSelect.appendChild(option);
    });
}

function stopStream(stream) {
    stream?.getTracks().forEach((track) => track.stop());
}

function logTrackDetails(prefix, track) {
    if (!track) {
        log(`${prefix}: no track`);
        return;
    }

    const settings = track.getSettings ? track.getSettings() : {};
    const constraints = track.getConstraints ? track.getConstraints() : {};
    log(`${prefix}: kind=${track.kind}, id=${track.id}, label="${track.label}", enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
    log(`${prefix} settings: ${JSON.stringify(settings)}`);
    log(`${prefix} constraints: ${JSON.stringify(constraints)}`);
    track.onmute = () => log(`${prefix}: muted`);
    track.onunmute = () => log(`${prefix}: unmuted`);
    track.onended = () => log(`${prefix}: ended`);
}

function chooseRecorderMimeType() {
    const type = 'audio/webm;codecs=opus';
    return MediaRecorder.isTypeSupported(type) ? type : '';
}

function cleanupStreams() {
    if (mixAudioContext) {
        mixAudioContext.close().catch(() => {});
        mixAudioContext = null;
    }
    stopStream(microphoneStream);
    stopStream(systemAudioStream);
    stopStream(displayStreamForSession);
    stopStream(mixedStream);
    microphoneStream = null;
    systemAudioStream = null;
    displayStreamForSession = null;
    mixedStream = null;
}

async function buildMixedStream() {
    microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: micSelect.value
            ? { deviceId: { exact: micSelect.value } }
            : true,
        video: false
    });
    log(`Microphone stream id=${microphoneStream.id}, audioTracks=${microphoneStream.getAudioTracks().length}`);
    logTrackDetails('Mic track', microphoneStream.getAudioTracks()[0]);

    let displayStream;
    try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: false
        });
        log('Display capture mode: audio-only (video=false).');
    } catch (error) {
        log(`Audio-only display capture failed (${error.message}). Falling back to video=true.`);
        displayStream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: true
        });
        log('Display capture mode: audio+video fallback (video=true).');
    }
    displayStreamForSession = displayStream;
    log(`Display stream id=${displayStream.id}, videoTracks=${displayStream.getVideoTracks().length}, audioTracks=${displayStream.getAudioTracks().length}`);
    logTrackDetails('Display audio track', displayStream.getAudioTracks()[0]);
    logTrackDetails('Display video track', displayStream.getVideoTracks()[0]);

    const displayAudioTrack = displayStream.getAudioTracks()[0];
    if (!displayAudioTrack || displayAudioTrack.readyState !== 'live') {
        throw new Error('System audio loopback track is not live');
    }
    systemAudioStream = displayStream;

    mixAudioContext = new AudioContext({ sampleRate: 48000 });
    await mixAudioContext.resume();
    log(`AudioContext state=${mixAudioContext.state}, sampleRate=${mixAudioContext.sampleRate}`);
    const destination = mixAudioContext.createMediaStreamDestination();

    const micSource = mixAudioContext.createMediaStreamSource(microphoneStream);
    micSource.connect(destination);

    const systemSource = mixAudioContext.createMediaStreamSource(systemAudioStream);
    systemSource.connect(destination);
    log('Capturing microphone + system audio.');

    mixedStream = destination.stream;
    log(`Mixed stream id=${mixedStream.id}, audioTracks=${mixedStream.getAudioTracks().length}`);
    logTrackDetails('Mixed track', mixedStream.getAudioTracks()[0]);
}

async function startCaptureAndLoop() {
    if (recordingInProgress) {
        return;
    }

    try {
        recordingInProgress = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        micSelect.disabled = true;
        loopPlayer.pause();

        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
        }

        setCaptureStatus('Capture: Recording 10 seconds...', true);
        setPlaybackStatus('Playback: Waiting for recording', false);
        shouldStartPlayback = true;

        await buildMixedStream();

        chunks = [];
        const selectedMimeType = chooseRecorderMimeType();
        if (!selectedMimeType) {
            throw new Error('audio/webm;codecs=opus is not supported on this runtime');
        }
        const recorderOptions = { mimeType: selectedMimeType };
        log(`MediaRecorder mimeType selected: ${selectedMimeType || 'browser default'}`);
        mediaRecorder = new MediaRecorder(mixedStream, recorderOptions);
        log(`MediaRecorder actual mimeType: ${mediaRecorder.mimeType || 'unknown'}`);
        mediaRecorder.onerror = (event) => {
            log(`MediaRecorder error: ${event.error?.name || 'unknown'} ${event.error?.message || ''}`.trim());
        };

        mediaRecorder.ondataavailable = (event) => {
            log(`MediaRecorder chunk: ${event.data.size} bytes`);
            if (event.data.size > 0) {
                chunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            const blobType = selectedMimeType || mediaRecorder.mimeType || 'audio/webm';
            const blob = new Blob(chunks, { type: blobType });
            log(`Recorder stopped. chunks=${chunks.length}, blob.size=${blob.size}, blob.type=${blob.type}`);
            objectUrl = URL.createObjectURL(blob);

            cleanupStreams();

            if (!shouldStartPlayback) {
                setCaptureStatus('Capture: Idle', false);
                setPlaybackStatus('Playback: Stopped', false);
                recordingInProgress = false;
                startBtn.disabled = false;
                stopBtn.disabled = true;
                micSelect.disabled = false;
                log('Recording canceled.');
                return;
            }

            loopPlayer.src = objectUrl;
            loopPlayer.loop = true;
            loopPlayer.onloadedmetadata = () => {
                log(`Loop player metadata loaded. duration=${Number.isFinite(loopPlayer.duration) ? loopPlayer.duration.toFixed(2) : 'unknown'}s`);
            };
            loopPlayer.onplay = () => log('Loop player started playback.');
            loopPlayer.onerror = () => log(`Loop player error: ${loopPlayer.error?.message || 'unknown'}`);

            setCaptureStatus('Capture: Complete', true);
            setPlaybackStatus('Playback: Looping', true);
            log('Recording complete. Starting loop playback.');

            try {
                await loopPlayer.play();
            } catch (error) {
                log(`Autoplay blocked: ${error.message}. Click play on the audio control.`);
            }

            recordingInProgress = false;
            startBtn.disabled = false;
            micSelect.disabled = false;
        };

        mediaRecorder.start();
        log(`Recording started. mediaRecorder.state=${mediaRecorder.state}`);

        stopTimer = setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                log('Recording stopped after 10 seconds.');
            }
        }, RECORDING_MS);
    } catch (error) {
        log(`Failed to record: ${error.message}`);
        setCaptureStatus('Capture: Error', false);
        setPlaybackStatus('Playback: Stopped', false);
        stopAll();
    }
}

function stopAll() {
    if (stopTimer) {
        clearTimeout(stopTimer);
        stopTimer = null;
    }

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        shouldStartPlayback = false;
        mediaRecorder.stop();
    }
    mediaRecorder = null;

    loopPlayer.pause();
    loopPlayer.currentTime = 0;

    cleanupStreams();

    recordingInProgress = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    micSelect.disabled = false;

    setCaptureStatus('Capture: Idle', false);
    setPlaybackStatus('Playback: Stopped', false);
    log('Loop stopped.');
}

startBtn.addEventListener('click', startCaptureAndLoop);
stopBtn.addEventListener('click', stopAll);

updateMicSelect().catch((error) => log(`Mic list failed: ${error.message}`));
window.addEventListener('beforeunload', stopAll);
