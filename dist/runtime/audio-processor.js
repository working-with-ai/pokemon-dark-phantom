class EMUSoundProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const {sampleRate} = options.processorOptions;
        //buffer size
        this.bufferSize = sampleRate / 60 * 16;
        //环形缓冲区
        this.audioSpareSamplesRingBuffer = new Float32Array(this.bufferSize);
        //缓冲区写指针
        this.audioSpareWritePtr = 0;
        //缓冲区读指针
        this.audioSpareReadPtr = 0;
        //缓冲区中可用的数据量
        this.bufferAvailable = 0;
        //是否单声道
        this.singleTrack = false;
        //构建环形缓冲区
        this.port.onmessage = this.onmessage.bind(this);
    }

    onmessage(event) {
        const {heap16, singleTrack} = event.data;
        this.singleTrack = singleTrack;
        for (let i = 0; i < heap16.length; i++) {
            // 确保不超出缓冲区
            if (this.bufferAvailable < this.bufferSize) {
                // 16位转换为浮点数
                this.audioSpareSamplesRingBuffer[this.audioSpareWritePtr] = heap16[i] / 0x4000;
                // 环形缓冲区的写指针更新
                this.audioSpareWritePtr = (this.audioSpareWritePtr + 1) % this.bufferSize;
                this.bufferAvailable++;
            } else {
                // console.warn("Buffer overflow, skipping samples");
                break;
            }
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const leftChannel = output[0];
        const rightChannel = output[1];
        const numSamples = leftChannel.length;
        for (let i = 0; i < numSamples; i++) {
            if (this.bufferAvailable > 0) {
                const sample = this.audioSpareSamplesRingBuffer[this.audioSpareReadPtr];
                //左/右声道
                leftChannel[i] = sample;
                rightChannel[i] = sample;
                //步长
                let step = 1;
                //如果是双声道
                if (!this.singleTrack) {
                    rightChannel[i] = this.audioSpareSamplesRingBuffer[this.audioSpareReadPtr + 1];
                    step = 2;
                }
                //每次读取 step 个样本
                this.audioSpareReadPtr = (this.audioSpareReadPtr + step) % this.bufferSize;
                this.bufferAvailable -= step;
            } else {
                leftChannel[i] = 0;
                rightChannel[i] = 0;
            }
        }
        return true;
    }
}

try {
    registerProcessor('emu-sound-processor', EMUSoundProcessor);
} catch (error) {
    console.error("Failed to register AudioWorkletProcessor:", error);
}