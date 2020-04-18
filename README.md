### TPoT (Transport Packets over Tunnels)
A simple (optionally authenticated) remote development/test/demo proxy over HTTP, powered by WebSockets. No additional ports required. Designed to be used with a reverse proxy for TLS.

***

### Requirements

* Developed & tested against Node 12
* An available TCP port for the server


### Installation
You can simply clone this repository, `npm install`, and run `node index.js`. However, we also publish it as a Docker container.

### Run as a Container
The container is hosted on Docker Hub with the name `signal24/tpot-server`.

Example:
```
docker run -d --name tpot-server -p 3000:3000 -e DOMAIN=yourdomain.com signal24/tpot-server
```

### Configuration

These may be provided as environment variables, or specified in a `.env` file in the project root.

- **DOMAIN** *(required)*
Incoming HTTP requests will be parsed and their host will be checked against this variable. Requests will be directed to this domain for tunnel creation, and to subdomains of this domain for tunnel traffic. All other requests will result in a 404.

- **AUTH_KEY**
If you don't want _everyone_ to be able to use your TPoT server, you can specify an authentication key. For security, it must be at least 32 characters. If provided, clients will require the same key to connect.

- **PORT**
The port you want the server to listen on. By default, this is 3000.

### Why does this require a reverse proxy for TLS?

Our setup has the TPoT server running as a Docker container in a Kubernetes cluster, behind an nginx ingress controller. The ingress controller already provides TLS offloading for us, so it just makes sense.

If demand is high enough, we may add TLS support here - but it's easy enough to set up an nginx reverse proxy if you need support sooner. (Need help? Open an issue, and we'll whip up a sample config.)

### Where's the client?

[Here](https://github.com/signal24/tpot-client).

***

### How does this work?

WebSockets.

The client connects to the server over a WebSocket (HTTP or HTTPS), and either requests a specific subdomain, or the server randomly assigns it one.  When the server receives a request for your assigned subdomain, it opens a new "conversation" by assigning a conversation ID for that tunnel, and sending a message to your client with the conversation ID, the conversation type (just HTTP for now; raw data in the future), and the sender IP and port. The server then just forwards all the raw data it receives over the WebSocket, prefixed with the conversation ID. The client does the same, just in reverse.

In the case of HTTP conversations, the client analyzes the inbound traffic so that it can rewrite the HTTP host header. This behavior is enabled by default, but can be disabled using the `--no-host-rewrite` flag.

### Is this secure?

That depends on your setup.

If you expose your server over HTTPS, then all communication between the client and server is secure, and all communication between the remote user and the server is secure. Don't confuse this with end-to-end encryption: the server still has to decrypt the data to know which tunnel to send it through. As long as you trust that your server is secure, then you can trust that communication from the remote user to your TPoT client is secure.

As for the security from your TPoT client to your target... that's up to you.

*NOTE: HTTPS target support is right around the corner.*


### How is this any different than ngrok, localtunnel, etc?

Most importantly: it's open source, and fully under your control!

We accidentally ran into the upper limit of ngrok's per-minute connection limit, and didn't like that the paid plans had what still felt like low limits.

localtunnel seemed decent, but it opened random ports to establish connections, which wasn't compatible with trying to run the server as a simple deployment on our Kubernetes cluster.

For HTTP/S support (which is the only thing supported at the moment!), TPoT's server needs nothing more than a single port, which can run on its own dedicated cloud server, or as a container in a Kubernetes deployment, behind an nginx ingress controller (which is how we run it). All traffic for both the clients and the remote users is routed through the single port.


### Where are the tests??

Feel free to write them :)