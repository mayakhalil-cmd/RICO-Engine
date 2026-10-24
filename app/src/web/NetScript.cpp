// Raw UDP, TCP and serial ports for script panels. See NetScript.h.

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <winhttp.h>

#include "NetScript.h"

#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <thread>

namespace {

struct Port {
    enum Kind { Udp, Tcp, Serial } kind = Udp;
    SOCKET sock = INVALID_SOCKET;
    HANDLE serial = INVALID_HANDLE_VALUE;
    bool connecting = false;
};

std::map<std::string, Port> g_ports;
SOCKET g_sendSocket = INVALID_SOCKET;

bool startWinsock() {
    static bool started = false;
    if (!started) {
        WSADATA wsa;
        started = WSAStartup(MAKEWORD(2, 2), &wsa) == 0;
    }
    return started;
}

void setNonBlocking(SOCKET s) {
    u_long on = 1;
    ioctlsocket(s, FIONBIO, &on);
}

bool resolve(const std::string& host, int port, sockaddr_in& out) {
    memset(&out, 0, sizeof(out));
    out.sin_family = AF_INET;
    out.sin_port = htons((u_short)port);
    if (inet_pton(AF_INET, host.c_str(), &out.sin_addr) == 1) return true;
    addrinfo hints{}, *res = nullptr;
    hints.ai_family = AF_INET;
    if (getaddrinfo(host.c_str(), nullptr, &hints, &res) != 0 || !res) return false;
    out.sin_addr = ((sockaddr_in*)res->ai_addr)->sin_addr;
    freeaddrinfo(res);
    return true;
}

void closePort(Port& p) {
    if (p.sock != INVALID_SOCKET) closesocket(p.sock);
    if (p.serial != INVALID_HANDLE_VALUE) CloseHandle(p.serial);
    p.sock = INVALID_SOCKET;
    p.serial = INVALID_HANDLE_VALUE;
}

void pad4(std::vector<uint8_t>& b) {
    do b.push_back(0); while (b.size() % 4);
}
void putString(std::vector<uint8_t>& b, const std::string& s) {
    b.insert(b.end(), s.begin(), s.end());
    pad4(b);
}
void putBE32(std::vector<uint8_t>& b, uint32_t v) {
    b.push_back((uint8_t)(v >> 24)); b.push_back((uint8_t)(v >> 16));
    b.push_back((uint8_t)(v >> 8)); b.push_back((uint8_t)v);
}

} // namespace

std::string NetScript_UdpOpen(const std::string& id, int port) {
    if (!startWinsock()) return "The network is not available.";
    NetScript_Close(id);
    SOCKET s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s == INVALID_SOCKET) return "Could not make a UDP socket.";
    BOOL reuse = TRUE;
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, (const char*)&reuse, sizeof(reuse));
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons((u_short)port);
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(s, (sockaddr*)&addr, sizeof(addr)) != 0) {
        closesocket(s);
        return "Port " + std::to_string(port) + " is already in use by another app.";
    }
    setNonBlocking(s);
    Port p;
    p.kind = Port::Udp;
    p.sock = s;
    g_ports[id] = p;
    return "";
}

std::string NetScript_UdpSend(const std::string& host, int port, const std::vector<uint8_t>& data) {
    if (!startWinsock()) return "The network is not available.";
    if (g_sendSocket == INVALID_SOCKET) {
        g_sendSocket = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (g_sendSocket == INVALID_SOCKET) return "Could not make a UDP socket.";
        BOOL broadcast = TRUE;
        setsockopt(g_sendSocket, SOL_SOCKET, SO_BROADCAST, (const char*)&broadcast, sizeof(broadcast));
    }
    sockaddr_in to;
    if (!resolve(host, port, to)) return "Could not find " + host + ".";
    if (sendto(g_sendSocket, (const char*)data.data(), (int)data.size(), 0, (sockaddr*)&to, sizeof(to)) < 0)
        return "Sending to " + host + " failed.";
    return "";
}

std::string NetScript_TcpConnect(const std::string& id, const std::string& host, int port) {
    if (!startWinsock()) return "The network is not available.";
    NetScript_Close(id);
    sockaddr_in to;
    if (!resolve(host, port, to)) return "Could not find " + host + ".";
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return "Could not make a TCP socket.";
    setNonBlocking(s);
    int r = connect(s, (sockaddr*)&to, sizeof(to));
    if (r != 0 && WSAGetLastError() != WSAEWOULDBLOCK) {
        closesocket(s);
        return "Could not connect to " + host + ":" + std::to_string(port) + ".";
    }
    Port p;
    p.kind = Port::Tcp;
    p.sock = s;
    p.connecting = r != 0;
    g_ports[id] = p;
    return "";
}

std::string NetScript_TcpSend(const std::string& id, const std::vector<uint8_t>& data) {
    auto it = g_ports.find(id);
    if (it == g_ports.end() || it->second.kind != Port::Tcp) return "No TCP connection called " + id + ".";
    size_t sent = 0;
    while (sent < data.size()) {
        int n = send(it->second.sock, (const char*)data.data() + sent, (int)(data.size() - sent), 0);
        if (n <= 0) {
            if (WSAGetLastError() == WSAEWOULDBLOCK) { Sleep(1); continue; }
            return "The connection " + id + " is closed.";
        }
        sent += (size_t)n;
    }
    return "";
}

std::vector<std::string> NetScript_SerialPorts() {
    std::vector<std::string> out;
    char target[512];
    for (int i = 1; i <= 64; ++i) {
        std::string name = "COM" + std::to_string(i);
        if (QueryDosDeviceA(name.c_str(), target, sizeof(target))) out.push_back(name);
    }
    return out;
}

std::string NetScript_SerialOpen(const std::string& id, const std::string& port, int baud) {
    NetScript_Close(id);
    std::string path = "\\\\.\\" + port;
    HANDLE h = CreateFileA(path.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
    if (h == INVALID_HANDLE_VALUE) return "Could not open " + port + ". Another app may be using it.";
    DCB dcb{};
    dcb.DCBlength = sizeof(dcb);
    GetCommState(h, &dcb);
    dcb.BaudRate = (DWORD)baud;
    dcb.ByteSize = 8;
    dcb.Parity = NOPARITY;
    dcb.StopBits = ONESTOPBIT;
    dcb.fDtrControl = DTR_CONTROL_ENABLE;   // boards like the Pi Pico only talk once DTR is on
    dcb.fRtsControl = RTS_CONTROL_ENABLE;
    if (!SetCommState(h, &dcb)) {
        CloseHandle(h);
        return "That speed does not work with " + port + ".";
    }
    COMMTIMEOUTS t{};
    t.ReadIntervalTimeout = MAXDWORD;      // reads return right away with what is there
    t.WriteTotalTimeoutConstant = 50;
    SetCommTimeouts(h, &t);
    Port p;
    p.kind = Port::Serial;
    p.serial = h;
    g_ports[id] = p;
    return "";
}

std::string NetScript_SerialSend(const std::string& id, const std::vector<uint8_t>& data) {
    auto it = g_ports.find(id);
    if (it == g_ports.end() || it->second.kind != Port::Serial) return "No serial port called " + id + ".";
    DWORD written = 0;
    if (!WriteFile(it->second.serial, data.data(), (DWORD)data.size(), &written, nullptr))
        return "Writing to " + id + " failed.";
    return "";
}

void NetScript_Close(const std::string& id) {
    auto it = g_ports.find(id);
    if (it == g_ports.end()) return;
    closePort(it->second);
    g_ports.erase(it);
}

void NetScript_CloseAll() {
    for (auto& kv : g_ports) closePort(kv.second);
    g_ports.clear();
}

std::string NetScript_OscSend(const std::string& host, int port, const std::string& address, const std::vector<OscArg>& args) {
    if (address.empty() || address[0] != '/') return "OSC addresses start with /";
    std::vector<uint8_t> b;
    putString(b, address);
    std::string tags = ",";
    for (const auto& a : args) tags += a.isString ? 's' : a.isInt ? 'i' : 'f';
    putString(b, tags);
    for (const auto& a : args) {
        if (a.isString) putString(b, a.text);
        else if (a.isInt) putBE32(b, (uint32_t)(int32_t)a.number);
        else {
            float f = (float)a.number;
            uint32_t bits;
            memcpy(&bits, &f, 4);
            putBE32(b, bits);
        }
    }
    return NetScript_UdpSend(host, port, b);
}

// ---- web requests ----

namespace {
std::mutex g_httpLock;
std::vector<NetEvent> g_httpDone;

std::wstring widen(const std::string& s) {
    if (s.empty()) return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w((size_t)n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), &w[0], n);
    return w;
}

void finish(const std::string& id, int status, const std::string& reason, std::vector<uint8_t> data) {
    NetEvent e{ "http", id, std::to_string(status), std::move(data) };
    if (status == 0) e.data.assign(reason.begin(), reason.end());
    std::lock_guard<std::mutex> lock(g_httpLock);
    g_httpDone.push_back(std::move(e));
}

void httpRun(std::string id, std::string method, std::string url, std::string headers, std::vector<uint8_t> body, int timeoutMs) {
    std::wstring wurl = widen(url);
    URL_COMPONENTS u{};
    u.dwStructSize = sizeof(u);
    wchar_t host[256] = {}, path[2048] = {};
    u.lpszHostName = host; u.dwHostNameLength = 255;
    u.lpszUrlPath = path; u.dwUrlPathLength = 2047;
    wchar_t extra[2048] = {};
    u.lpszExtraInfo = extra; u.dwExtraInfoLength = 2047;
    if (!WinHttpCrackUrl(wurl.c_str(), 0, 0, &u)) return finish(id, 0, "That address does not look right: " + url, {});
    HINTERNET s = WinHttpOpen(L"RICO", WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!s) return finish(id, 0, "Web requests are not available on this PC.", {});
    WinHttpSetTimeouts(s, timeoutMs, timeoutMs, timeoutMs, timeoutMs);
    HINTERNET c = WinHttpConnect(s, host, u.nPort, 0);
    std::wstring full = std::wstring(path) + extra;
    if (full.empty()) full = L"/";
    HINTERNET r = c ? WinHttpOpenRequest(c, widen(method).c_str(), full.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                         u.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0) : nullptr;
    auto close = [&] { if (r) WinHttpCloseHandle(r); if (c) WinHttpCloseHandle(c); WinHttpCloseHandle(s); };
    if (!r) { close(); return finish(id, 0, "Could not reach " + url + ".", {}); }
    if (u.nScheme == INTERNET_SCHEME_HTTPS) {
        // Printers on your own network use their own certificates.
        DWORD flags = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_CN_INVALID | SECURITY_FLAG_IGNORE_CERT_DATE_INVALID;
        WinHttpSetOption(r, WINHTTP_OPTION_SECURITY_FLAGS, &flags, sizeof(flags));
    }
    std::wstring wh = widen(headers);
    BOOL sent = WinHttpSendRequest(r, wh.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : wh.c_str(), wh.empty() ? 0 : (DWORD)-1,
                                   body.empty() ? WINHTTP_NO_REQUEST_DATA : body.data(), (DWORD)body.size(), (DWORD)body.size(), 0);
    if (!sent || !WinHttpReceiveResponse(r, nullptr)) {
        DWORD err = GetLastError();
        close();
        return finish(id, 0, err == ERROR_WINHTTP_TIMEOUT ? "The printer did not answer in time." : "Could not reach " + url + ". Is it on and on this network?", {});
    }
    DWORD status = 0, len = sizeof(status);
    WinHttpQueryHeaders(r, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &len, WINHTTP_NO_HEADER_INDEX);
    std::vector<uint8_t> data;
    for (;;) {
        DWORD avail = 0;
        if (!WinHttpQueryDataAvailable(r, &avail) || avail == 0) break;
        size_t at = data.size();
        data.resize(at + avail);
        DWORD got = 0;
        if (!WinHttpReadData(r, data.data() + at, avail, &got)) { data.resize(at); break; }
        data.resize(at + got);
        if (data.size() > 8 * 1024 * 1024) break;   // answers from printers are small
    }
    close();
    finish(id, (int)status, "", std::move(data));
}
}  // namespace

std::string NetScript_Http(const std::string& id, const std::string& method, const std::string& url,
                           const std::string& headers, const std::vector<uint8_t>& body, int timeoutMs) {
    if (url.rfind("http://", 0) != 0 && url.rfind("https://", 0) != 0) return "The address has to start with http:// or https://";
    std::thread(httpRun, id, method.empty() ? std::string("GET") : method, url, headers, body, timeoutMs < 500 ? 15000 : timeoutMs).detach();
    return "";
}

void NetScript_Poll(const std::function<void(const NetEvent&)>& emit) {
    {
        std::vector<NetEvent> done;
        { std::lock_guard<std::mutex> lock(g_httpLock); done.swap(g_httpDone); }
        for (const auto& e : done) emit(e);
    }
    uint8_t buf[65536];
    std::vector<std::string> dead;
    for (auto& [id, p] : g_ports) {
        if (p.kind == Port::Udp) {
            for (int i = 0; i < 64; ++i) {
                sockaddr_in from{};
                int len = sizeof(from);
                int n = recvfrom(p.sock, (char*)buf, sizeof(buf), 0, (sockaddr*)&from, &len);
                if (n <= 0) break;
                char ip[64] = {};
                inet_ntop(AF_INET, &from.sin_addr, ip, sizeof(ip));
                emit({ "udp", id, std::string(ip) + ":" + std::to_string(ntohs(from.sin_port)), std::vector<uint8_t>(buf, buf + n) });
            }
        } else if (p.kind == Port::Tcp) {
            if (p.connecting) {
                fd_set w;
                FD_ZERO(&w);
                FD_SET(p.sock, &w);
                timeval tv{ 0, 0 };
                if (select(0, nullptr, &w, nullptr, &tv) > 0) p.connecting = false;
                else continue;
            }
            for (;;) {
                int n = recv(p.sock, (char*)buf, sizeof(buf), 0);
                if (n > 0) { emit({ "tcp", id, "", std::vector<uint8_t>(buf, buf + n) }); continue; }
                if (n == 0 || WSAGetLastError() != WSAEWOULDBLOCK) dead.push_back(id);
                break;
            }
        } else {
            DWORD n = 0;
            if (ReadFile(p.serial, buf, sizeof(buf), &n, nullptr)) {
                if (n > 0) emit({ "serial", id, "", std::vector<uint8_t>(buf, buf + n) });
            } else {
                dead.push_back(id);
            }
        }
    }
    for (const auto& id : dead) {
        NetScript_Close(id);
        emit({ "closed", id, "", {} });
    }
}
