#pragma once
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

// A very small HTTP + WebSocket server for the RICO interface.
//
// It serves the files in the "ui" folder and upgrades /ws to a WebSocket.
// Everything runs on the thread that calls Poll(), so the engine never has
// to lock anything for the UI. Only one interface connection is expected,
// but more work fine (for example a tablet on the same network).

class LocalServer {
public:
    using TextHandler = std::function<void(int client, const std::string& text)>;
    using BinaryHandler = std::function<void(int client, const uint8_t* data, size_t size)>;
    using ConnectHandler = std::function<void(int client)>;

    ~LocalServer();

    // port 0 picks a free port. allowNetwork=false only accepts this computer.
    bool Start(int port, const std::string& webRoot, bool allowNetwork);
    void Stop();
    int  Port() const { return m_port; }
    bool Running() const { return m_listen != ~(uintptr_t)0; }

    void Poll();

    void Broadcast(const std::string& text, int except = -1);
    void Send(int client, const std::string& text);
    void BroadcastBinary(const uint8_t* data, size_t size);
    int  ClientCount() const;

    TextHandler onText;
    BinaryHandler onBinary;
    ConnectHandler onConnect;

private:
    struct Client {
        uintptr_t sock = ~(uintptr_t)0;
        int id = 0;
        bool websocket = false;
        bool closing = false;
        std::string in;            // bytes not yet parsed
        std::string out;           // bytes not yet sent
        std::string fragments;     // payload of a fragmented message
        uint8_t fragmentOpcode = 0;
    };

    void accept();
    bool readFrom(Client& c);
    void handleHttp(Client& c);
    void handleFrames(Client& c);
    void flush(Client& c);
    void queueFrame(Client& c, uint8_t opcode, const void* data, size_t size);
    void serveFile(Client& c, std::string path);

    uintptr_t m_listen = ~(uintptr_t)0;
    int m_port = 0;
    int m_nextId = 1;
    std::string m_root;
    std::vector<Client> m_clients;
};
