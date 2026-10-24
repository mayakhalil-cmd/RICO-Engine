#include "src/ui/tabs/UICommon.h"
#include "src/video/NetworkVideo.h"
#include "src/video/PluginHost.h"

#include <dxgi1_2.h>

NetVideoState g_netVideo;

namespace {

const RicoVideoTransportApi* g_api = nullptr;
bool g_senderOpen = false;
std::vector<std::string> g_sources;

// Sending
ID3D11Texture2D* g_staging = nullptr;
std::vector<uint8_t> g_packed;          // tightly packed BGRA for the transport
IDXGIOutputDuplication* g_dup = nullptr;
ID3D11Texture2D* g_screenCopy = nullptr;

std::vector<uint8_t> g_canvas;
int g_canvasW = 0, g_canvasH = 0;
bool g_canvasDirty = false;

// Receiving
ID3D11Texture2D* g_recvTex = nullptr;
ID3D11ShaderResourceView* g_recvSRV = nullptr;
std::vector<uint8_t> g_lastReceived;    // kept for passthrough and the Spout bridge
spoutDX* g_spoutBridge = nullptr;

template <typename T> void release(T*& p) { if (p) { p->Release(); p = nullptr; } }

const RicoVideoTransportApi* transportAt(int index) {
    const auto& list = PluginHost_Transports();
    if (index < 0 || index >= (int)list.size()) return nullptr;
    return list[index].api;
}

bool ensureStaging(int w, int h, DXGI_FORMAT fmt) {
    if (g_staging) {
        D3D11_TEXTURE2D_DESC d;
        g_staging->GetDesc(&d);
        if ((int)d.Width == w && (int)d.Height == h && d.Format == fmt) return true;
        release(g_staging);
    }
    D3D11_TEXTURE2D_DESC desc = {};
    desc.Width = w;
    desc.Height = h;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = fmt;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_STAGING;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    return SUCCEEDED(g_pd3dDevice->CreateTexture2D(&desc, nullptr, &g_staging));
}

// Copies a mapped texture into g_packed as BGRA. The swap chain is RGBA, so
// those frames get their red and blue channels swapped on the way.
void pack(const D3D11_MAPPED_SUBRESOURCE& m, int w, int h, bool swapRB) {
    g_packed.resize((size_t)w * h * 4);
    const uint8_t* src = static_cast<const uint8_t*>(m.pData);
    uint8_t* dst = g_packed.data();
    for (int y = 0; y < h; ++y) {
        const uint8_t* s = src + (size_t)y * m.RowPitch;
        uint8_t* d = dst + (size_t)y * w * 4;
        if (!swapRB) {
            memcpy(d, s, (size_t)w * 4);
            continue;
        }
        for (int x = 0; x < w; ++x) {
            d[0] = s[2]; d[1] = s[1]; d[2] = s[0]; d[3] = s[3];
            s += 4; d += 4;
        }
    }
}

bool sendPacked(int w, int h) {
    RicoVideoFrame f;
    f.width = w;
    f.height = h;
    f.stride = w * 4;
    f.data = g_packed.data();
    f.fps_num = 60000;
    f.fps_den = 1000;
    g_netVideo.width = w;
    g_netVideo.height = h;
    return g_api->sender_send(&f) == 1;
}

bool sendTexture(ID3D11Texture2D* tex, bool swapRB) {
    D3D11_TEXTURE2D_DESC d;
    tex->GetDesc(&d);
    if (!ensureStaging(d.Width, d.Height, d.Format)) return false;
    g_pd3dDeviceContext->CopyResource(g_staging, tex);
    D3D11_MAPPED_SUBRESOURCE m;
    if (FAILED(g_pd3dDeviceContext->Map(g_staging, 0, D3D11_MAP_READ, 0, &m))) return false;
    pack(m, d.Width, d.Height, swapRB);
    g_pd3dDeviceContext->Unmap(g_staging, 0);
    return sendPacked(d.Width, d.Height);
}

void sendWindow() {
    if (!g_mainRenderTargetView) return;
    ID3D11Resource* res = nullptr;
    g_mainRenderTargetView->GetResource(&res);
    if (!res) return;
    ID3D11Texture2D* tex = nullptr;
    if (SUCCEEDED(res->QueryInterface(__uuidof(ID3D11Texture2D), (void**)&tex))) {
        D3D11_TEXTURE2D_DESC d;
        tex->GetDesc(&d);
        sendTexture(tex, d.Format == DXGI_FORMAT_R8G8B8A8_UNORM);
        tex->Release();
    }
    res->Release();
}

void stopScreen() {
    release(g_screenCopy);
    release(g_dup);
}

bool startScreen(int monitor) {
    stopScreen();
    IDXGIDevice* dxgiDevice = nullptr;
    IDXGIAdapter* adapter = nullptr;
    IDXGIOutput* output = nullptr;
    IDXGIOutput1* output1 = nullptr;
    HRESULT hr = g_pd3dDevice->QueryInterface(__uuidof(IDXGIDevice), (void**)&dxgiDevice);
    if (SUCCEEDED(hr)) hr = dxgiDevice->GetAdapter(&adapter);
    if (SUCCEEDED(hr)) hr = adapter->EnumOutputs(monitor, &output);
    if (FAILED(hr) && adapter) hr = adapter->EnumOutputs(0, &output);
    if (SUCCEEDED(hr)) hr = output->QueryInterface(__uuidof(IDXGIOutput1), (void**)&output1);
    if (SUCCEEDED(hr)) hr = output1->DuplicateOutput(g_pd3dDevice, &g_dup);
    release(output1);
    release(output);
    release(adapter);
    release(dxgiDevice);
    if (FAILED(hr)) {
        char msg[160];
        snprintf(msg, sizeof(msg),
                 "Screen capture is not available (0x%08lX). Remote Desktop and some GPUs block it.",
                 (unsigned long)hr);
        g_netVideo.lastError = msg;
        return false;
    }
    return true;
}

void sendScreen() {
    if (!g_dup) return;
    IDXGIResource* res = nullptr;
    DXGI_OUTDUPL_FRAME_INFO info;
    HRESULT hr = g_dup->AcquireNextFrame(0, &info, &res);
    if (hr == DXGI_ERROR_ACCESS_LOST) {
        startScreen(g_netVideo.monitor);
        return;
    }
    if (FAILED(hr)) return;   // no new frame yet
    ID3D11Texture2D* tex = nullptr;
    if (SUCCEEDED(res->QueryInterface(__uuidof(ID3D11Texture2D), (void**)&tex))) {
        sendTexture(tex, false);
        tex->Release();
    }
    res->Release();
    g_dup->ReleaseFrame();
}

void ensureReceiveTexture(int w, int h) {
    if (g_recvTex && g_netVideo.receivedWidth == w && g_netVideo.receivedHeight == h) return;
    release(g_recvSRV);
    release(g_recvTex);
    D3D11_TEXTURE2D_DESC desc = {};
    desc.Width = w;
    desc.Height = h;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DYNAMIC;
    desc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    if (FAILED(g_pd3dDevice->CreateTexture2D(&desc, nullptr, &g_recvTex))) return;
    g_pd3dDevice->CreateShaderResourceView(g_recvTex, nullptr, &g_recvSRV);
    g_netVideo.receivedWidth = w;
    g_netVideo.receivedHeight = h;
}

void onFrame(const RicoVideoFrame* f, void*) {
    if (f->width <= 0 || f->height <= 0) return;
    size_t row = (size_t)f->width * 4;
    g_lastReceived.resize(row * f->height);
    for (int y = 0; y < f->height; ++y)
        memcpy(&g_lastReceived[row * y], f->data + (size_t)f->stride * y, row);

    ensureReceiveTexture(f->width, f->height);
    if (!g_recvTex) return;
    D3D11_MAPPED_SUBRESOURCE m;
    if (SUCCEEDED(g_pd3dDeviceContext->Map(g_recvTex, 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) {
        for (int y = 0; y < f->height; ++y)
            memcpy((uint8_t*)m.pData + (size_t)m.RowPitch * y, &g_lastReceived[row * y], row);
        g_pd3dDeviceContext->Unmap(g_recvTex, 0);
    }
}

void updateSpoutBridge() {
    if (!g_netVideo.bridgeToSpout) {
        if (g_spoutBridge) {
            g_spoutBridge->ReleaseSender();
            delete g_spoutBridge;
            g_spoutBridge = nullptr;
        }
        return;
    }
    if (g_lastReceived.empty()) return;
    if (!g_spoutBridge) {
        g_spoutBridge = new spoutDX();
        g_spoutBridge->OpenDirectX11(g_pd3dDevice);
        g_spoutBridge->SetSenderName(g_netVideo.spoutBridgeName);
        g_spoutBridge->SetSenderFormat(DXGI_FORMAT_B8G8R8A8_UNORM);
    }
    g_spoutBridge->SendImage(g_lastReceived.data(), g_netVideo.receivedWidth, g_netVideo.receivedHeight);
}

} // namespace

void NetVideo_Init() {
    PluginHost_Scan();
    NetVideo_SelectTransport(g_netVideo.transport);
}

void NetVideo_Shutdown() {
    NetVideo_StopSending();
    NetVideo_Disconnect();
    g_netVideo.bridgeToSpout = false;
    updateSpoutBridge();
    stopScreen();
    release(g_staging);
    PluginHost_Unload();
    g_api = nullptr;
}

bool NetVideo_TransportAvailable(int index) {
    const RicoVideoTransportApi* api = transportAt(index);
    return api && api->is_available();
}

bool NetVideo_SelectTransport(int index) {
    const RicoVideoTransportApi* api = transportAt(index);
    if (!api) {
        index = 0;
        api = transportAt(0);
    }
    if (api == g_api) return g_api != nullptr;

    bool wasSending = g_netVideo.sending;
    std::string wasReceiving = g_netVideo.receiving ? g_netVideo.sourceName : "";
    NetVideo_StopSending();
    NetVideo_Disconnect();
    if (g_api) g_api->stop();

    g_api = api;
    g_netVideo.transport = index;
    g_sources.clear();
    if (!g_api) return false;

    if (wasSending) NetVideo_StartSending();
    (void)wasReceiving;   // source names are different per transport
    return true;
}

const char* NetVideo_TransportName() {
    const auto& list = PluginHost_Transports();
    if (g_netVideo.transport < 0 || g_netVideo.transport >= (int)list.size()) return "None";
    return list[g_netVideo.transport].name.c_str();
}

const char* NetVideo_TransportStatus() {
    if (!g_api) return "No video transport available.";
    g_api->is_available();
    return g_api->status_text();
}

bool NetVideo_StartSending() {
    if (!g_api) return false;
    if (!g_api->start() || !g_api->sender_open(g_netVideo.senderName)) {
        g_netVideo.lastError = g_api->status_text();
        g_netVideo.sending = false;
        return false;
    }
    g_senderOpen = true;
    g_netVideo.sending = true;
    g_netVideo.lastError.clear();
    if (g_netVideo.source == NetVideoSource::Screen) startScreen(g_netVideo.monitor);
    LogInfo("Network video: sending \"%s\" over %s", g_netVideo.senderName, NetVideo_TransportName());
    return true;
}

void NetVideo_StopSending() {
    if (g_api && g_senderOpen) g_api->sender_close();
    g_senderOpen = false;
    g_netVideo.sending = false;
    stopScreen();
}

bool NetVideo_SetSource(NetVideoSource source, int monitor) {
    g_netVideo.source = source;
    g_netVideo.monitor = monitor;
    stopScreen();
    if (source == NetVideoSource::Screen && g_netVideo.sending)
        return startScreen(monitor);
    return true;
}

void NetVideo_SubmitCanvasFrame(const uint8_t* rgba, int width, int height) {
    if (!rgba || width <= 0 || height <= 0) return;
    size_t n = (size_t)width * height * 4;
    g_canvas.resize(n);
    for (size_t i = 0; i < n; i += 4) {
        g_canvas[i + 0] = rgba[i + 2];
        g_canvas[i + 1] = rgba[i + 1];
        g_canvas[i + 2] = rgba[i + 0];
        g_canvas[i + 3] = rgba[i + 3];
    }
    g_canvasW = width;
    g_canvasH = height;
    g_canvasDirty = true;
}

const uint8_t* NetVideo_CanvasFrame(int& width, int& height) {
    width = g_canvasW;
    height = g_canvasH;
    return g_canvas.empty() ? nullptr : g_canvas.data();
}

void NetVideo_SendFrame() {
    if (!g_netVideo.sending || !g_senderOpen || !g_api) return;

    switch (g_netVideo.source) {
    case NetVideoSource::Window:
        sendWindow();
        break;
    case NetVideoSource::Screen:
        sendScreen();
        break;
    case NetVideoSource::Passthrough:
        if (!g_lastReceived.empty()) {
            g_packed = g_lastReceived;
            sendPacked(g_netVideo.receivedWidth, g_netVideo.receivedHeight);
        }
        break;
    case NetVideoSource::Spout:
        if (g_spoutState.receiverInitialized && g_spoutState.displayTexture) {
            D3D11_TEXTURE2D_DESC d;
            g_spoutState.displayTexture->GetDesc(&d);
            if (d.Format == DXGI_FORMAT_B8G8R8A8_UNORM || d.Format == DXGI_FORMAT_R8G8B8A8_UNORM) {
                sendTexture(g_spoutState.displayTexture, d.Format == DXGI_FORMAT_R8G8B8A8_UNORM);
            } else if (g_netVideo.lastError.empty()) {
                g_netVideo.lastError = "This Spout sender uses a high bit depth format. Set it to 8-bit RGBA in the sending app.";
            }
        }
        break;
    case NetVideoSource::Canvas:
        if (g_canvasDirty) {
            g_packed.swap(g_canvas);
            sendPacked(g_canvasW, g_canvasH);
            g_canvas.swap(g_packed);
            g_canvasDirty = false;
        }
        break;
    }
}

void NetVideo_RefreshSources() {
    g_sources.clear();
    if (!g_api || !g_api->start()) return;
    std::vector<char> buf(16384);
    int count = g_api->find_sources(buf.data(), (int)buf.size());
    if (count <= 0) return;
    std::string all(buf.data());
    size_t start = 0;
    while (start <= all.size()) {
        size_t end = all.find('\n', start);
        if (end == std::string::npos) end = all.size();
        if (end > start) g_sources.push_back(all.substr(start, end - start));
        start = end + 1;
    }
}

const std::vector<std::string>& NetVideo_Sources() { return g_sources; }

bool NetVideo_Connect(const char* sourceName) {
    if (!g_api || !sourceName || !*sourceName) return false;
    NetVideo_Disconnect();
    if (!g_api->receiver_open(sourceName)) {
        g_netVideo.lastError = std::string("Could not connect to ") + sourceName;
        return false;
    }
    strncpy_s(g_netVideo.sourceName, sizeof(g_netVideo.sourceName), sourceName, _TRUNCATE);
    g_netVideo.receiving = true;
    g_netVideo.lastError.clear();
    LogInfo("Network video: receiving \"%s\" over %s", sourceName, NetVideo_TransportName());
    return true;
}

void NetVideo_Disconnect() {
    if (g_api && g_netVideo.receiving) g_api->receiver_close();
    g_netVideo.receiving = false;
    g_netVideo.receivedWidth = 0;
    g_netVideo.receivedHeight = 0;
    g_lastReceived.clear();
    release(g_recvSRV);
    release(g_recvTex);
}

bool NetVideo_Receive() {
    bool got = false;
    if (g_api && g_netVideo.receiving)
        got = g_api->receiver_poll(onFrame, nullptr) == 1;
    if (got || !g_netVideo.bridgeToSpout) updateSpoutBridge();
    return got;
}

ID3D11ShaderResourceView* NetVideo_ReceivedSRV() { return g_recvSRV; }
