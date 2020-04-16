// control: 0x11 + 1 byte control command + data
// convo:   0x12 + 2 byte conversation ID + 1 byte control command + data

module.exports = {
    MSG_CONTROL: 0x11,
    MSG_CONVO: 0x12,

    CONTROL_GREETINGS: 'G'.charCodeAt(0),

    TYPE_HTTP: 'H'.charCodeAt(0),
    TYPE_RAW: 'R'.charCodeAt(0),

    CONVO_DATA: 'D'.charCodeAt(0),
    CONVO_PAUSE: 'P'.charCodeAt(0),
    CONVO_RESUME: 'C'.charCodeAt(0),
    CONVO_CLOSED: 'X'.charCodeAt(0),
    CONVO_NOCONNECT: 'N'.charCodeAt(0)
}