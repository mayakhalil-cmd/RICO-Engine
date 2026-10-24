#include "src/ui/tabs/UICommon.h"
#include "osc/OscOutboundPacketStream.h"
#include "osc/OscReceivedElements.h"
#include "osc/OscPacketListener.h"
#include "ip/UdpSocket.h"

std::unique_ptr<UdpTransmitSocket> g_oscSender;
std::vector<OSCDestination> g_oscDestinations;

// OSC LISTENER
class MidiOscListener : public osc::OscPacketListener {
protected:
    virtual void ProcessMessage(const osc::ReceivedMessage& m, const IpEndpointName& remoteEndpoint) override {
        try {
            std::string address = m.AddressPattern();

            if (g_config.sendToMIDI) {
                for (auto& pair : g_controlMappings) {
                    ControlMapping& mapping = pair.second;
                    if (mapping.oscAddress == address) {
                        std::vector<unsigned char> midiMsg;
                        auto arg = m.ArgumentsBegin();
                        if (arg != m.ArgumentsEnd()) {
                            switch (mapping.controlType) {
                            case (int)MidiControlType::Note:
                                if (arg->IsInt32() || arg->IsBool()) {
                                    int velocity = arg->IsInt32() ? arg->AsInt32() : (arg->AsBool() ? 127 : 0);
                                    midiMsg = { static_cast<unsigned char>(0x90 + mapping.channel - 1),
                                        static_cast<unsigned char>(mapping.controller),
                                        static_cast<unsigned char>(SafeClamp(velocity, 0, 127)) };
                                }
                                break;
                            case (int)MidiControlType::CC:
                                if (arg->IsFloat()) {
                                    float value = arg->AsFloat();
                                    int ccValue = static_cast<int>(value * 127.0f);
                                    midiMsg = { static_cast<unsigned char>(0xB0 + mapping.channel - 1),
                                        static_cast<unsigned char>(mapping.controller),
                                        static_cast<unsigned char>(SafeClamp(ccValue, 0, 127)) };
                                }
                                break;
                            }
                            if (!midiMsg.empty())
                                SendMidiMessage(midiMsg);
                        }
                        break;
                    }
                }
            }

            float firstValue = 0.0f;
            auto first = m.ArgumentsBegin();
            if (first != m.ArgumentsEnd()) {
                if (first->IsFloat()) firstValue = first->AsFloat();
                else if (first->IsInt32()) firstValue = (float)first->AsInt32();
                else if (first->IsBool()) firstValue = first->AsBool() ? 1.0f : 0.0f;
                else if (first->IsDouble()) firstValue = (float)first->AsDouble();
            }

            std::lock_guard<std::mutex> lock(g_logMutex);

            MidiMessage msg;
            auto now = std::chrono::system_clock::now();
            auto time_t = std::chrono::system_clock::to_time_t(now);
            char timeStr[100];
            std::tm localTm{};
            localtime_s(&localTm, &time_t);
            strftime(timeStr, sizeof(timeStr), "%H:%M:%S", &localTm);
            msg.timestamp = timeStr;
            msg.type = "OSC in";
            msg.description = "Received: " + address;
            msg.oscAddress = address;
            msg.normalizedValue = firstValue;
            PushLogLocked(msg);
        }
        catch (osc::Exception& e) {
            LogInfo("OSC error: %s", e.what());
        }
    }
};

// DESTINATION MANAGEMENT
void AddOSCDestination(const std::string& name, const std::string& ip, int port) {
    OSCDestination dest(name, ip, port);
    try {
        dest.sender = std::make_unique<UdpTransmitSocket>(IpEndpointName(ip.c_str(), port));
        dest.connected = true;
    }
    catch (std::exception& e) {
        dest.connected = false;
        std::cout << "Failed to create OSC destination " << name << ": " << e.what() << std::endl;
    }
    g_oscDestinations.push_back(std::move(dest));
}

void RemoveOSCDestination(size_t index) {
    if (index < g_oscDestinations.size())
        g_oscDestinations.erase(g_oscDestinations.begin() + index);
}

void InitializeOSCDestinations() {
    for (auto& dest : g_oscDestinations) {
        try {
            dest.sender = std::make_unique<UdpTransmitSocket>(IpEndpointName(dest.ip.c_str(), dest.port));
            dest.connected = true;
        }
        catch (std::exception& e) {
            dest.connected = false;
            std::cout << "Failed to initialize OSC destination " << dest.name << ": " << e.what() << std::endl;
        }
    }
}

void SendOSCToAllDestinations(const char* address, float value) {
    for (auto& dest : g_oscDestinations) {
        if (dest.enabled && dest.connected && dest.sender) {
            try {
                char buffer[1024];
                osc::OutboundPacketStream p(buffer, 1024);
                p << osc::BeginMessage(address) << value << osc::EndMessage;
                dest.sender->Send(p.Data(), p.Size());
            }
            catch (std::exception& e) {
                std::cout << "Failed to send OSC to " << dest.name << ": " << e.what() << std::endl;
                dest.connected = false;
            }
        }
    }
}

void SendOSCToAllDestinations(const char* address, int value) {
    for (auto& dest : g_oscDestinations) {
        if (dest.enabled && dest.connected && dest.sender) {
            try {
                char buffer[1024];
                osc::OutboundPacketStream p(buffer, 1024);
                p << osc::BeginMessage(address) << value << osc::EndMessage;
                dest.sender->Send(p.Data(), p.Size());
            }
            catch (std::exception& e) {
                std::cout << "Failed to send OSC to " << dest.name << ": " << e.what() << std::endl;
                dest.connected = false;
            }
        }
    }
}

// INIT & THREAD
void InitializeOSC() {
    try {
        g_oscSender = std::make_unique<UdpTransmitSocket>(IpEndpointName(g_config.oscIP, g_config.oscSendPort));
        g_oscState.senderReady = true;
        InitializeOSCDestinations();
    }
    catch (std::exception& e) {
        LogInfo("OSC could not start: %s", e.what());
        g_oscState.senderReady = false;
    }
}

static std::atomic<UdpListeningReceiveSocket*> s_oscListenSocket{ nullptr };

void OSCReceiveThread() {
    try {
        MidiOscListener listener;
        UdpListeningReceiveSocket socket(IpEndpointName(IpEndpointName::ANY_ADDRESS, g_config.oscListenPort), &listener);
        s_oscListenSocket = &socket;
        socket.Run();
        s_oscListenSocket = nullptr;
    }
    catch (std::exception& e) {
        s_oscListenSocket = nullptr;
        LogInfo("OSC listen port %d is busy or blocked: %s", g_config.oscListenPort, e.what());
    }
}

// Unblocks OSCReceiveThread so it can be joined.
void StopOSCReceive() {
    if (UdpListeningReceiveSocket* s = s_oscListenSocket.load())
        s->AsynchronousBreak();
}

