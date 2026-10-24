#include "src/ui/tabs/UICommon.h"
#include <SpoutDX.h>

spoutDX* g_spout = nullptr;
spoutDX* g_spoutReceiver = nullptr;
std::vector<std::string> g_spoutSenderList;

void UpdateSpoutSenderList() {
    g_spoutSenderList.clear();
    if (!g_spoutReceiver) {
        g_spoutReceiver = new spoutDX();
        g_spoutReceiver->OpenDirectX11(g_pd3dDevice);
    }
    int count = g_spoutReceiver->GetSenderCount();
    char name[256];
    for (int i = 0; i < count; i++) {
        if (g_spoutReceiver->GetSender(i, name, 256))
            g_spoutSenderList.push_back(name);
    }
    g_spoutState.lastScanTime = (float)GetTickCount() / 1000.0f;
}

bool ConnectSpoutReceiver(const char* senderName) {
    if (!g_spoutReceiver) {
        g_spoutReceiver = new spoutDX();
        g_spoutReceiver->OpenDirectX11(g_pd3dDevice);
    }
    g_spoutReceiver->SetReceiverName(senderName);
    g_spoutState.receiverInitialized = true;
    strcpy_s(g_spoutState.receiverName, senderName);
    return true;
}

void DisconnectSpoutReceiver() {
    if (g_spoutState.displaySRV) { g_spoutState.displaySRV->Release();     g_spoutState.displaySRV = nullptr; }
    if (g_spoutState.displayTexture) { g_spoutState.displayTexture->Release(); g_spoutState.displayTexture = nullptr; }
    g_spoutState.receivedTexture = nullptr;
    if (g_spoutReceiver) g_spoutReceiver->ReleaseReceiver();
    g_spoutState.receiverInitialized = false;
    g_spoutState.receivedWidth = g_spoutState.receivedHeight = 0;
    if (g_sharedTexture) { g_sharedTexture->Release(); g_sharedTexture = nullptr; }
    g_spoutState.sharedTextureHandle = nullptr;
}

bool CreateSpoutDisplaySRV() {
    if (!g_spoutState.receivedTexture || !g_pd3dDevice) return false;
    if (g_spoutState.displaySRV) { g_spoutState.displaySRV->Release();     g_spoutState.displaySRV = nullptr; }
    if (g_spoutState.displayTexture) { g_spoutState.displayTexture->Release(); g_spoutState.displayTexture = nullptr; }

    D3D11_TEXTURE2D_DESC srcDesc;
    g_spoutState.receivedTexture->GetDesc(&srcDesc);

    D3D11_TEXTURE2D_DESC texDesc = {};
    texDesc.Width = srcDesc.Width;
    texDesc.Height = srcDesc.Height;
    texDesc.MipLevels = 1;
    texDesc.ArraySize = 1;
    // Same format as the sender, or CopyResource silently does nothing.
    texDesc.Format = srcDesc.Format;
    texDesc.SampleDesc.Count = 1;
    texDesc.Usage = D3D11_USAGE_DEFAULT;
    texDesc.BindFlags = D3D11_BIND_SHADER_RESOURCE;

    if (FAILED(g_pd3dDevice->CreateTexture2D(&texDesc, nullptr, &g_spoutState.displayTexture)))
        return false;

    D3D11_SHADER_RESOURCE_VIEW_DESC srvDesc = {};
    srvDesc.Format = texDesc.Format;
    srvDesc.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
    srvDesc.Texture2D.MipLevels = 1;

    if (FAILED(g_pd3dDevice->CreateShaderResourceView(g_spoutState.displayTexture, &srvDesc, &g_spoutState.displaySRV))) {
        g_spoutState.displayTexture->Release();
        g_spoutState.displayTexture = nullptr;
        return false;
    }
    return true;
}

void CleanupSpout() {
    if (g_spoutState.displaySRV) { g_spoutState.displaySRV->Release();     g_spoutState.displaySRV = nullptr; }
    if (g_spoutState.displayTexture) { g_spoutState.displayTexture->Release(); g_spoutState.displayTexture = nullptr; }
    g_spoutState.receivedTexture = nullptr; // Spout owns this pointer, do not Release()
    if (g_spoutReceiver) {
        g_spoutReceiver->ReleaseReceiver();
        delete g_spoutReceiver;
        g_spoutReceiver = nullptr;
    }
    g_spoutState.receiverInitialized = false;
    g_spoutState.receivedWidth = 0;
    g_spoutState.receivedHeight = 0;
    if (g_sharedTexture) { g_sharedTexture->Release(); g_sharedTexture = nullptr; }
    g_spoutState.sharedTextureHandle = nullptr;
    if (g_spout) {
        g_spout->ReleaseSender();
        delete g_spout;
        g_spout = nullptr;
    }
    g_spoutState.initialized = false;
}

bool ExportSharedTextureHandle() {
    if (!g_spoutState.receivedTexture || !g_spoutReceiver) return false;

    ID3D11Device* spoutDevice = g_spoutReceiver->GetDX11Device();
    if (!spoutDevice) return false;

    if (!g_sharedTexture) {
        D3D11_TEXTURE2D_DESC spoutDesc;
        g_spoutState.receivedTexture->GetDesc(&spoutDesc);

        D3D11_TEXTURE2D_DESC sharedDesc = {};
        sharedDesc.Width = spoutDesc.Width;
        sharedDesc.Height = spoutDesc.Height;
        sharedDesc.MipLevels = 1;
        sharedDesc.ArraySize = 1;
        sharedDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        sharedDesc.SampleDesc.Count = 1;
        sharedDesc.Usage = D3D11_USAGE_DEFAULT;
        sharedDesc.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
        sharedDesc.MiscFlags = D3D11_RESOURCE_MISC_SHARED;

        if (FAILED(spoutDevice->CreateTexture2D(&sharedDesc, nullptr, &g_sharedTexture)))
            return false;

        IDXGIResource* dxgiRes = nullptr;
        if (FAILED(g_sharedTexture->QueryInterface(__uuidof(IDXGIResource), (void**)&dxgiRes))) {
            g_sharedTexture->Release(); g_sharedTexture = nullptr; return false;
        }
        HANDLE handle = nullptr;
        HRESULT hr = dxgiRes->GetSharedHandle(&handle);
        dxgiRes->Release();
        if (FAILED(hr) || !handle) {
            g_sharedTexture->Release(); g_sharedTexture = nullptr; return false;
        }
        g_spoutState.sharedTextureHandle = handle;

        std::ofstream f(g_spoutState.sharedHandlePath);
        if (f) {
            f << std::hex << reinterpret_cast<uintptr_t>(handle) << "\n"
                << std::dec << spoutDesc.Width << "\n"
                << spoutDesc.Height << "\n";
        }
    }

    ID3D11DeviceContext* ctx = nullptr;
    spoutDevice->GetImmediateContext(&ctx);
    if (ctx) { ctx->CopyResource(g_sharedTexture, g_spoutState.receivedTexture); ctx->Release(); }
    return true;
}

bool UpdateSpoutReceiver() {
    if (!g_spoutState.receiverInitialized || !g_spoutReceiver) return false;

    bool received = g_spoutReceiver->ReceiveTexture();
    if (!received) return false;

    g_spoutState.receivedTexture = g_spoutReceiver->GetSenderTexture();
    if (!g_spoutState.receivedTexture) return false;

    unsigned int newW = g_spoutReceiver->GetSenderWidth();
    unsigned int newH = g_spoutReceiver->GetSenderHeight();

    // Rebuild display SRV when resolution changes or first frame arrives
    if (newW != g_spoutState.receivedWidth || newH != g_spoutState.receivedHeight || !g_spoutState.displaySRV) {
        g_spoutState.receivedWidth = newW;
        g_spoutState.receivedHeight = newH;
        CreateSpoutDisplaySRV();
    }

    // Copy new frame into our display texture every frame
    if (g_spoutState.displayTexture && g_pd3dDeviceContext)
        g_pd3dDeviceContext->CopyResource(g_spoutState.displayTexture, g_spoutState.receivedTexture);

    return true;
}

// ---- Sending -------------------------------------------------------------

bool SpoutSender_Start() {
    if (!g_spout) g_spout = new spoutDX();
    if (!g_spout->OpenDirectX11(g_pd3dDevice)) {
        delete g_spout;
        g_spout = nullptr;
        return false;
    }
    g_spout->SetSenderName(g_spoutState.senderName);
    g_spoutState.initialized = true;
    LogInfo("Spout: sending as \"%s\"", g_spoutState.senderName);
    return true;
}

void SpoutSender_Stop() {
    if (g_spout) {
        g_spout->ReleaseSender();
        delete g_spout;
        g_spout = nullptr;
    }
    g_spoutState.initialized = false;
}

void SpoutSender_SendFrame() {
    if (!g_spoutState.initialized || !g_spout) return;

    if (g_spoutState.sendCanvas) {
        int w = 0, h = 0;
        if (const uint8_t* frame = NetVideo_CanvasFrame(w, h))
            g_spout->SendImage(frame, w, h);
        return;
    }

    if (!g_mainRenderTargetView) return;
    ID3D11Resource* res = nullptr;
    g_mainRenderTargetView->GetResource(&res);
    if (!res) return;
    ID3D11Texture2D* tex = nullptr;
    if (SUCCEEDED(res->QueryInterface(__uuidof(ID3D11Texture2D), (void**)&tex))) {
        g_spout->SendTexture(tex);
        tex->Release();
    }
    res->Release();
}
