function EMUSound(emscriptenModule) {
    this.emscriptenModule = emscriptenModule;
    this.sampleRateVal = 44100;
    this.audioCtx = null;
    this.gainNode = null;
    this.audioWorkletNode = null;
    this.audioScriptNode = null;
    this.resumeTimer = null;
    this._workletLoading = false;
    this._unlocked = false;

    // ScriptProcessor / 环形缓冲（Worklet 失败时的降级，iframe 常用）
    this.bufferSize = Math.floor(this.sampleRateVal / 60 * 16);
    this.audioSpareSamplesRingBuffer = new Float32Array(this.bufferSize);
    this.audioSpareWritePtr = 0;
    this.audioSpareReadPtr = 0;
    this.bufferAvailable = 0;
    this.singleTrack = false;

    this._bindUnlockOnGesture();
    this._ensureAudioGraph();
    this._startResumeTimer();
}

/** 创建 AudioContext + 输出节点；Worklet 不可用时降级 ScriptProcessor */
EMUSound.prototype._ensureAudioGraph = function () {
    try {
        if (!this.audioCtx) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) {
                console.warn('EMUSound: AudioContext unavailable');
                return;
            }
            this.audioCtx = new AC({ sampleRate: this.sampleRateVal });
            this.gainNode = this.audioCtx.createGain();
            this.gainNode.connect(this.audioCtx.destination);
        }

        if (this.audioWorkletNode || this.audioScriptNode) {
            return;
        }

        var self = this;
        if (this.audioCtx.audioWorklet && typeof this.audioCtx.audioWorklet.addModule === 'function') {
            if (this._workletLoading) return;
            this._workletLoading = true;
            // 用绝对 URL，避免 SPA / 跨路径解析失败
            var moduleUrl = new URL('runtime/audio-processor.js', document.baseURI).href;
            this.audioCtx.audioWorklet.addModule(moduleUrl).then(function () {
                if (self.audioWorkletNode || self.audioScriptNode) {
                    self._workletLoading = false;
                    return;
                }
                self.audioWorkletNode = new AudioWorkletNode(self.audioCtx, 'emu-sound-processor', {
                    outputChannelCount: [2],
                    processorOptions: { sampleRate: self.sampleRateVal }
                });
                self.audioWorkletNode.connect(self.gainNode);
                self._workletLoading = false;
            }).catch(function (e) {
                console.warn('EMUSound: audioWorklet addModule failed, fallback ScriptProcessor', e);
                self._workletLoading = false;
                self._initScriptProcessorFallback();
            });
        } else {
            console.warn('EMUSound: audioWorklet unavailable, fallback ScriptProcessor');
            this._initScriptProcessorFallback();
        }
    } catch (e) {
        console.error('EMUSound _ensureAudioGraph failed:', e);
        try {
            this._initScriptProcessorFallback();
        } catch (e2) {}
    }
};

/** AudioWorklet 不可用时用 ScriptProcessor 播音（iframe / 旧浏览器） */
EMUSound.prototype._initScriptProcessorFallback = function () {
    if (this.audioScriptNode || !this.audioCtx) return;
    try {
        // 0 输入 / 2 输出，与 worklet 立体声一致
        this.audioScriptNode = this.audioCtx.createScriptProcessor(2048, 0, 2);
        this.audioScriptNode.onaudioprocess = this.handleAudioEvent.bind(this);
        if (this.gainNode) {
            this.audioScriptNode.connect(this.gainNode);
        } else {
            this.audioScriptNode.connect(this.audioCtx.destination);
        }
    } catch (e) {
        console.error('EMUSound ScriptProcessor fallback failed:', e);
        this.audioScriptNode = null;
    }
};

EMUSound.prototype._startResumeTimer = function () {
    var self = this;
    if (this.resumeTimer) clearInterval(this.resumeTimer);
    this.resumeTimer = setInterval(function () {
        if (!self.audioCtx) return;
        if (self.audioCtx.state === 'suspended') {
            self.audioCtx.resume().catch(function () {});
        } else if (self.audioCtx.state === 'running' && (self.audioWorkletNode || self.audioScriptNode)) {
            clearInterval(self.resumeTimer);
            self.resumeTimer = null;
        }
    }, 200);
};

/**
 * 用户手势解锁：iframe 内必须点一下才能出声。
 * 同时补建音频图（防止 Worklet 失败后一直无输出节点）。
 */
EMUSound.prototype._bindUnlockOnGesture = function () {
    var self = this;
    var unlock = function () {
        self._ensureAudioGraph();
        if (!self.audioCtx) return;

        var afterResume = function () {
            self._unlocked = true;
            // 若 Worklet 仍未就绪，手势时强制降级，保证点一下就能出声
            if (!self.audioWorkletNode && !self.audioScriptNode && !self._workletLoading) {
                self._initScriptProcessorFallback();
            }
            if (self.audioCtx.state === 'running' && (self.audioWorkletNode || self.audioScriptNode)) {
                document.removeEventListener('touchstart', unlock, true);
                document.removeEventListener('touchend', unlock, true);
                document.removeEventListener('click', unlock, true);
                document.removeEventListener('keydown', unlock, true);
                if (self.resumeTimer) {
                    clearInterval(self.resumeTimer);
                    self.resumeTimer = null;
                }
            }
        };

        if (self.audioCtx.state === 'suspended') {
            self.audioCtx.resume().then(afterResume).catch(function () {
                afterResume();
            });
        } else {
            afterResume();
        }
    };
    document.addEventListener('touchstart', unlock, true);
    document.addEventListener('touchend', unlock, true);
    document.addEventListener('click', unlock, true);
    document.addEventListener('keydown', unlock, true);
};

EMUSound.prototype.initAudioContext = function () {
    this._ensureAudioGraph();
};

EMUSound.prototype.getSampleRate = function () {
    return (this.audioCtx && this.audioCtx.sampleRate) || this.sampleRateVal || 44100;
};

EMUSound.prototype.currentAudioTime = function () {
    return this.audioCtx ? this.audioCtx.currentTime : Date.now() / 1000;
};

EMUSound.prototype.getNumExtraSamples = function () {
    return this.bufferAvailable || 0;
};

EMUSound.prototype.setVolume = function (volume) {
    if (!this.gainNode || !this.audioCtx) return;
    volume = Math.max(0, Math.min(volume, 1));
    this.gainNode.gain.setValueAtTime(volume, this.audioCtx.currentTime);
};

EMUSound.prototype.resetSound = function () {
    this.playEnd = true;
    this.audioSpareWritePtr = 0;
    this.audioSpareReadPtr = 0;
    this.bufferAvailable = 0;
};

/** 写入模拟器音频；Worklet 或 ScriptProcessor 环形缓冲二选一 */
EMUSound.prototype.writeSound = function (pointer8, length8) {
    if (!this.emscriptenModule || !this.emscriptenModule.HEAP16) return;

    var length16 = length8 >> 1;
    var pointer16 = pointer8 >> 1;
    var heap16 = this.emscriptenModule.HEAP16;
    var singleTrack = length16 <= 735;
    this.singleTrack = singleTrack;

    // 优先 AudioWorklet
    if (this.audioWorkletNode) {
        var audioData = new Array(length16);
        for (var i = 0; i < length16; i++) {
            audioData[i] = heap16[pointer16 + i];
        }
        try {
            this.audioWorkletNode.port.postMessage({
                heap16: audioData,
                singleTrack: singleTrack
            });
        } catch (error) {}
        return;
    }

    // 降级：写入环形缓冲，由 ScriptProcessor 消费
    if (!this.audioScriptNode) {
        // 懒补建，避免长期空跑
        this._ensureAudioGraph();
        if (!this.audioWorkletNode && !this.audioScriptNode && !this._workletLoading) {
            this._initScriptProcessorFallback();
        }
        if (!this.audioScriptNode) return;
    }

    for (var j = 0; j < length16; j++) {
        if (this.bufferAvailable >= this.bufferSize) break;
        this.audioSpareSamplesRingBuffer[this.audioSpareWritePtr] = heap16[pointer16 + j] / 0x4000;
        this.audioSpareWritePtr = (this.audioSpareWritePtr + 1) % this.bufferSize;
        this.bufferAvailable++;
    }
};

EMUSound.prototype.createBufferFromRingBuffer = function () {
};

/** ScriptProcessor 回调：从环形缓冲拉样本 */
EMUSound.prototype.handleAudioEvent = function (event) {
    var output = event.outputBuffer;
    var leftChannel = output.getChannelData(0);
    var rightChannel = output.numberOfChannels > 1 ? output.getChannelData(1) : leftChannel;
    var numSamples = leftChannel.length;

    for (var i = 0; i < numSamples; i++) {
        if (this.bufferAvailable > 0) {
            var sample = this.audioSpareSamplesRingBuffer[this.audioSpareReadPtr];
            leftChannel[i] = sample;
            rightChannel[i] = sample;
            var step = 1;
            if (!this.singleTrack && this.bufferAvailable > 1) {
                rightChannel[i] = this.audioSpareSamplesRingBuffer[(this.audioSpareReadPtr + 1) % this.bufferSize];
                step = 2;
            }
            this.audioSpareReadPtr = (this.audioSpareReadPtr + step) % this.bufferSize;
            this.bufferAvailable -= step;
            if (this.bufferAvailable < 0) this.bufferAvailable = 0;
        } else {
            leftChannel[i] = 0;
            rightChannel[i] = 0;
        }
    }
};

function IE_EMUSound(emscriptenModule) {
    this.emscriptenModule = emscriptenModule;
}

IE_EMUSound.prototype.getSampleRate = function () {
    return 44100;
};

IE_EMUSound.prototype.currentAudioTime = function () {
    return Date.now() / 1000;
};

IE_EMUSound.prototype.getNumExtraSamples = function () {
    return 0;
};

IE_EMUSound.prototype.resetSound = function () {
};

IE_EMUSound.prototype.writeSound = function () {
};
