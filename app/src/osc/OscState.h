#pragma once

struct OscState {
    bool senderReady = false;
    int sendPort = 8000;
    int listenPort = 9000;
};

extern OscState g_oscState;