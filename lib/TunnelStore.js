class TunnelStore {
    tunnels = {};
}

TunnelStore.instance = new TunnelStore;

module.exports = TunnelStore;