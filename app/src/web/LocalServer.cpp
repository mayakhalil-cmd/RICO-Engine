#include "src/web/LocalServer.h"

#include <algorithm>
#include <cstring>
#include <fstream>
#include <sstream>

#ifdef _WIN32
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <winsock2.h>
#  include <ws2tcpip.h>
   typedef int socklen_t;
#  define CLOSESOCK closesocket
#  define WOULD_BLOCK() (WSAGetLastError() == WSAEWOULDBLOCK)
#else
#  include <arpa/inet.h>
#  include <fcntl.h>
#  include <netinet/in.h>
#  include <netinet/tcp.h>
#  include <sys/socket.h>
#  include <unistd.h>
#  include <cerrno>
#  define CLOSESOCK close
#  define WOULD_BLOCK() (errno == EWOULDBLOCK || errno == EAGAIN)
#endif

namespace {

const uintptr_t kNoSocket = ~(uintptr_t)0;

// SHA-1 and base64, only used for the WebSocket handshake

struct Sha1 {
    uint32_t h[5] = { 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0 };

    static uint32_t rol(uint32_t v, int n) { return (v << n) | (v >> (32 - n)); }

    void block(const uint8_t* p) {
        uint32_t w[80];
        for (int i = 0; i < 16; ++i)
            w[i] = (uint32_t)p[i * 4] << 24 | (uint32_t)p[i * 4 + 1] << 16 | (uint32_t)p[i * 4 + 2] << 8 | p[i * 4 + 3];
        for (int i = 16; i < 80; ++i) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; ++i) {
            uint32_t f, k;
            if (i < 20)      { f = (b & c) | (~b & d);           k = 0x5A827999; }
            else if (i < 40) { f = b ^ c ^ d;                    k = 0x6ED9EBA1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d);  k = 0x8F1BBCDC; }
            else             { f = b ^ c ^ d;                    k = 0xCA62C1D6; }
            uint32_t t = rol(a, 5) + f + e + k + w[i];
            e = d; d = c; c = rol(b, 30); b = a; a = t;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }

    std::string digest(const std::string& msg) {
        std::string data = msg;
        uint64_t bits = (uint64_t)msg.size() * 8;
        data += (char)0x80;
        while (data.size() % 64 != 56) data += (char)0;
        for (int i = 7; i >= 0; --i) data += (char)((bits >> (i * 8)) & 0xFF);
        for (size_t i = 0; i < data.size(); i += 64) block((const uint8_t*)data.data() + i);
        std::string out;
        for (uint32_t v : h)
            for (int i = 3; i >= 0; --i) out += (char)((v >> (i * 8)) & 0xFF);
        return out;
    }
};

std::string base64(const std::string& in) {
    static const char* tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    int val = 0, bits = -6;
    for (unsigned char c : in) {
        val = (val << 8) + c;
        bits += 8;
        while (bits >= 0) {
            out += tbl[(val >> bits) & 0x3F];
            bits -= 6;
        }
    }
    if (bits > -6) out += tbl[((val << 8) >> (bits + 8)) & 0x3F];
    while (out.size() % 4) out += '=';
    return out;
}

std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return (char)std::tolower(c); });
    return s;
}

std::string header(const std::string& request, const std::string& name) {
    std::string req = lower(request);
    std::string key = "\r\n" + lower(name) + ":";
    size_t pos = req.find(key);
    if (pos == std::string::npos) return "";
    pos += key.size();
    size_t end = request.find("\r\n", pos);
    std::string v = request.substr(pos, end - pos);
    size_t a = v.find_first_not_of(" \t");
    size_t b = v.find_last_not_of(" \t");
    return a == std::string::npos ? "" : v.substr(a, b - a + 1);
}

const char* mimeFor(const std::string& path) {
    auto ends = [&](const char* ext) {
        size_t n = strlen(ext);
        return path.size() >= n && path.compare(path.size() - n, n, ext) == 0;
    };
    if (ends(".html")) return "text/html; charset=utf-8";
    if (ends(".js"))   return "text/javascript; charset=utf-8";
    if (ends(".css"))  return "text/css; charset=utf-8";
    if (ends(".json")) return "application/json";
    if (ends(".svg"))  return "image/svg+xml";
    if (ends(".png"))  return "image/png";
    if (ends(".ico"))  return "image/x-icon";
    if (ends(".woff2"))return "font/woff2";
    if (ends(".woff")) return "font/woff";
    if (ends(".ttf"))  return "font/ttf";
    if (ends(".otf"))  return "font/otf";
    if (ends(".glb"))  return "model/gltf-binary";
    return "application/octet-stream";
}

void setNonBlocking(uintptr_t s) {
#ifdef _WIN32
    u_long mode = 1;
    ioctlsocket((SOCKET)s, FIONBIO, &mode);
#else
    fcntl((int)s, F_SETFL, fcntl((int)s, F_GETFL, 0) | O_NONBLOCK);
#endif
    int one = 1;
    setsockopt((int)s, IPPROTO_TCP, TCP_NODELAY, (const char*)&one, sizeof(one));
}

} // namespace

LocalServer::~LocalServer() { Stop(); }

bool LocalServer::Start(int port, const std::string& webRoot, bool allowNetwork) {
    Stop();
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
#endif
    m_root = webRoot;
    if (!m_root.empty() && m_root.back() != '/' && m_root.back() != '\\') m_root += '/';

    uintptr_t s = (uintptr_t)socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == kNoSocket) return false;
    int one = 1;
#ifdef _WIN32
    setsockopt((SOCKET)s, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (const char*)&one, sizeof(one));
#else
    setsockopt((int)s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
#endif

    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons((uint16_t)port);
    addr.sin_addr.s_addr = htonl(allowNetwork ? INADDR_ANY : INADDR_LOOPBACK);
    if (bind(s, (sockaddr*)&addr, sizeof(addr)) != 0 || listen(s, 8) != 0) {
        CLOSESOCK(s);
        return false;
    }
    socklen_t len = sizeof(addr);
    getsockname(s, (sockaddr*)&addr, &len);
    m_port = ntohs(addr.sin_port);
    setNonBlocking(s);
    m_listen = s;
    return true;
}

void LocalServer::Stop() {
    for (auto& c : m_clients) CLOSESOCK(c.sock);
    m_clients.clear();
    if (m_listen != kNoSocket) CLOSESOCK(m_listen);
    m_listen = kNoSocket;
}

int LocalServer::ClientCount() const {
    int n = 0;
    for (const auto& c : m_clients)
        if (c.websocket && !c.closing) ++n;
    return n;
}

void LocalServer::accept() {
    for (;;) {
        uintptr_t s = (uintptr_t)::accept(m_listen, nullptr, nullptr);
        if (s == kNoSocket) return;
        setNonBlocking(s);
        Client c;
        c.sock = s;
        c.id = m_nextId++;
        m_clients.push_back(std::move(c));
    }
}

bool LocalServer::readFrom(Client& c) {
    char buf[65536];
    for (;;) {
        int n = (int)recv(c.sock, buf, sizeof(buf), 0);
        if (n > 0) {
            c.in.append(buf, n);
            if (c.in.size() > 64u * 1024 * 1024) return false;   // something is wrong
            continue;
        }
        if (n == 0) return false;
        return WOULD_BLOCK();
    }
}

void LocalServer::Poll() {
    if (m_listen == kNoSocket) return;
    accept();

    for (auto& c : m_clients) {
        if (!readFrom(c)) {
            c.closing = true;
            continue;
        }
        if (!c.websocket) handleHttp(c);
        if (c.websocket) handleFrames(c);
        flush(c);
    }

    m_clients.erase(std::remove_if(m_clients.begin(), m_clients.end(), [](Client& c) {
        if (c.closing && c.out.empty()) {
            CLOSESOCK(c.sock);
            return true;
        }
        return false;
    }), m_clients.end());
}

void LocalServer::handleHttp(Client& c) {
    size_t end = c.in.find("\r\n\r\n");
    if (end == std::string::npos) return;
    std::string request = c.in.substr(0, end + 2);
    c.in.erase(0, end + 4);

    std::istringstream line(request);
    std::string method, target;
    line >> method >> target;

    // Only answer requests made for this computer, so a web page somewhere
    // else can't talk to RICO through the browser (DNS rebinding).
    std::string host = lower(header(request, "Host"));
    std::string portSuffix = ":" + std::to_string(m_port);
    bool localHost = host == "127.0.0.1" + portSuffix || host == "localhost" + portSuffix;
    sockaddr_in peer = {};
    socklen_t plen = sizeof(peer);
    getpeername(c.sock, (sockaddr*)&peer, &plen);
    bool fromThisPc = ntohl(peer.sin_addr.s_addr) == INADDR_LOOPBACK;
    if (fromThisPc && !localHost) {
        c.out += "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        c.closing = true;
        return;
    }

    if (method != "GET") {
        c.out += "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        c.closing = true;
        return;
    }

    if (target == "/ws" && lower(header(request, "Upgrade")) == "websocket") {
        std::string key = header(request, "Sec-WebSocket-Key");
        std::string accept = base64(Sha1().digest(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"));
        c.out += "HTTP/1.1 101 Switching Protocols\r\n"
                 "Upgrade: websocket\r\n"
                 "Connection: Upgrade\r\n"
                 "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
        c.websocket = true;
        if (onConnect) onConnect(c.id);
        return;
    }

    serveFile(c, target);
}

void LocalServer::serveFile(Client& c, std::string path) {
    size_t q = path.find_first_of("?#");
    if (q != std::string::npos) path.resize(q);
    if (path.empty() || path == "/") path = "/index.html";
    if (path.find("..") != std::string::npos || path.find('\\') != std::string::npos) {
        c.out += "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        c.closing = true;
        return;
    }

    std::ifstream f(m_root + path.substr(1), std::ios::binary);
    size_t lastSlash = path.find_last_of('/');
    bool looksLikeFile = path.find('.', lastSlash) != std::string::npos;
    if (!f && !looksLikeFile) {
        // Single page app: unknown page paths get the main page. Missing
        // files (like an optional font) get a real 404.
        f.open(m_root + "index.html", std::ios::binary);
        path = "/index.html";
    }
    if (!f) {
        std::string body = looksLikeFile ? "Not found." : "RICO could not find its interface files (ui folder).";
        c.out += "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: " +
                 std::to_string(body.size()) + "\r\nConnection: close\r\n\r\n" + body;
        c.closing = true;
        return;
    }
    // read the whole file at once (much faster than char by char)
    f.seekg(0, std::ios::end);
    std::string body((size_t)(std::max)((std::streamoff)0, (std::streamoff)f.tellg()), '\0');
    f.seekg(0, std::ios::beg);
    if (!body.empty()) f.read(&body[0], (std::streamsize)body.size());
    c.out += "HTTP/1.1 200 OK\r\nContent-Type: ";
    c.out += mimeFor(path);
    // Built files have their version in the name, so the browser keeps them
    // and the next start is quicker. The main page is always asked for again.
    const bool versioned = path.rfind("/assets/", 0) == 0;
    c.out += versioned ? "\r\nCache-Control: public, max-age=31536000, immutable" : "\r\nCache-Control: no-cache";
    c.out += "\r\nContent-Length: " + std::to_string(body.size()) +
             "\r\nConnection: close\r\n\r\n";
    c.out += body;
    c.closing = true;
}

void LocalServer::handleFrames(Client& c) {
    for (;;) {
        if (c.in.size() < 2) return;
        const uint8_t* p = (const uint8_t*)c.in.data();
        bool fin = (p[0] & 0x80) != 0;
        uint8_t opcode = p[0] & 0x0F;
        bool masked = (p[1] & 0x80) != 0;
        uint64_t len = p[1] & 0x7F;
        size_t pos = 2;
        if (len == 126) {
            if (c.in.size() < 4) return;
            len = (uint64_t)p[2] << 8 | p[3];
            pos = 4;
        } else if (len == 127) {
            if (c.in.size() < 10) return;
            len = 0;
            for (int i = 0; i < 8; ++i) len = (len << 8) | p[2 + i];
            pos = 10;
        }
        if (!masked) {     // clients must mask, close otherwise
            c.closing = true;
            return;
        }
        if (c.in.size() < pos + 4 + len) return;
        uint8_t mask[4];
        memcpy(mask, p + pos, 4);
        pos += 4;

        std::string payload = c.in.substr(pos, (size_t)len);
        for (size_t i = 0; i < payload.size(); ++i) payload[i] ^= mask[i & 3];
        c.in.erase(0, pos + (size_t)len);

        if (opcode == 0x8) {                   // close
            queueFrame(c, 0x8, nullptr, 0);
            c.closing = true;
            return;
        }
        if (opcode == 0x9) {                   // ping
            queueFrame(c, 0xA, payload.data(), payload.size());
            continue;
        }
        if (opcode == 0xA) continue;           // pong

        if (opcode == 0x0) {                   // continuation
            c.fragments += payload;
            if (!fin) continue;
            payload.swap(c.fragments);
            c.fragments.clear();
            opcode = c.fragmentOpcode;
        } else if (!fin) {
            c.fragmentOpcode = opcode;
            c.fragments = payload;
            continue;
        }

        if (opcode == 0x1 && onText) onText(c.id, payload);
        if (opcode == 0x2 && onBinary) onBinary(c.id, (const uint8_t*)payload.data(), payload.size());
    }
}

void LocalServer::queueFrame(Client& c, uint8_t opcode, const void* data, size_t size) {
    uint8_t head[10];
    size_t n = 0;
    head[n++] = 0x80 | opcode;
    if (size < 126) {
        head[n++] = (uint8_t)size;
    } else if (size <= 0xFFFF) {
        head[n++] = 126;
        head[n++] = (uint8_t)(size >> 8);
        head[n++] = (uint8_t)size;
    } else {
        head[n++] = 127;
        for (int i = 7; i >= 0; --i) head[n++] = (uint8_t)((uint64_t)size >> (i * 8));
    }
    c.out.append((const char*)head, n);
    if (size) c.out.append((const char*)data, size);
}

void LocalServer::flush(Client& c) {
    while (!c.out.empty()) {
        int n = (int)send(c.sock, c.out.data(), (int)std::min<size_t>(c.out.size(), 1 << 20), 0);
        if (n > 0) {
            c.out.erase(0, n);
            continue;
        }
        if (n < 0 && WOULD_BLOCK()) return;
        c.out.clear();
        c.closing = true;
        return;
    }
}

void LocalServer::Send(int client, const std::string& text) {
    for (auto& c : m_clients) {
        if (c.id == client && c.websocket && !c.closing) {
            queueFrame(c, 0x1, text.data(), text.size());
            flush(c);
        }
    }
}

void LocalServer::Broadcast(const std::string& text, int except) {
    for (auto& c : m_clients) {
        if (!c.websocket || c.closing || c.id == except) continue;
        // A slow client (hidden tab, sleeping laptop) shouldn't make RICO
        // buffer forever. Drop updates for it until it catches up.
        if (c.out.size() > 8u * 1024 * 1024) continue;
        queueFrame(c, 0x1, text.data(), text.size());
        flush(c);
    }
}

void LocalServer::BroadcastBinary(const uint8_t* data, size_t size) {
    for (auto& c : m_clients) {
        if (!c.websocket || c.closing || c.out.size() > 8u * 1024 * 1024) continue;
        queueFrame(c, 0x2, data, size);
        flush(c);
    }
}
