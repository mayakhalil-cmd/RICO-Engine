#pragma once
#include <windows.h>
#include <d3d11.h>

struct SpoutState {
    bool initialized = false;
    bool receiverInitialized = false;
    char senderName[64] = "RICO";
    char receiverName[64] = "spoutout";
    unsigned int receivedWidth = 0;
    unsigned int receivedHeight = 0;
    float lastScanTime = -1.0f;
    bool sendCanvas = false;    // send the Create canvas instead of the RICO window

    // Texture sharing
    HANDLE                    sharedTextureHandle = nullptr;
    bool                      exportSharedHandle = false;
    char                      sharedHandlePath[260] = "";   // set at startup, inside the data folder
    ID3D11Texture2D* receivedTexture = nullptr; // Spout owns this, do not Release()
    ID3D11Texture2D* displayTexture = nullptr;
    ID3D11ShaderResourceView* displaySRV = nullptr;
};
extern SpoutState g_spoutState;