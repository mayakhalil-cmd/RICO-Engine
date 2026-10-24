#pragma once
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

// Raw network and serial ports for script panels.
//
// Script panels in the interface use these to talk to anything RICO does not
// support out of the box: a lighting desk with its own UDP protocol, a robot
// on TCP, a microcontroller on a COM port. Everything is non-blocking and runs
// on the bridge thread through NetScript_Poll().

struct NetEvent {
    std::string kind;     // "udp", "tcp", "serial", "closed", "http"
    std::string id;       // the name the script gave the port
    std::string from;     // sender address for UDP; for "http" the status code (0: failed, data is the reason)
    std::vector<uint8_t> data;
};

// Each call returns an empty string on success, or what went wrong.
std::string NetScript_UdpOpen(const std::string& id, int port);
std::string NetScript_UdpSend(const std::string& host, int port, const std::vector<uint8_t>& data);
std::string NetScript_TcpConnect(const std::string& id, const std::string& host, int port);
std::string NetScript_TcpSend(const std::string& id, const std::vector<uint8_t>& data);
std::string NetScript_SerialOpen(const std::string& id, const std::string& port, int baud);
std::string NetScript_SerialSend(const std::string& id, const std::vector<uint8_t>& data);
std::vector<std::string> NetScript_SerialPorts();
void NetScript_Close(const std::string& id);
void NetScript_CloseAll();

// OSC with any number of arguments to any host. Arguments may be numbers
// (sent as float, or int when isInt is set) or strings.
struct OscArg { bool isString = false; bool isInt = false; double number = 0; std::string text; };
std::string NetScript_OscSend(const std::string& host, int port, const std::string& address, const std::vector<OscArg>& args);

void NetScript_Poll(const std::function<void(const NetEvent&)>& emit);

// A web request (printers and lasers on the network: Klipper, OctoPrint,
// PrusaLink, FluidNC). It runs on its own thread, so a big upload never stops
// RICO; the answer comes back as a "http" event with the same id.
// headers: one "Name: value" per line.
std::string NetScript_Http(const std::string& id, const std::string& method, const std::string& url,
                           const std::string& headers, const std::vector<uint8_t>& body, int timeoutMs);
