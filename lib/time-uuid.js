'use strict';

const crypto = require('crypto');
const Long = require('long');
const Uuid = require('./uuid');

/** @module types */
/**
 * Oct 15, 1582 in milliseconds since unix epoch
 * @const
 * @private
 */
const _unixToGregorian = 12219292800000;
/**
 * 10,000 ticks in a millisecond
 * @const
 * @private
 */
const _ticksInMs = 10000;
/**
 * Counter used to generate up to 10000 different timeuuid values with the same Date
 * @private
 * @type {number}
 */
let _ticks = 0;
/**
 * Counter used to generate ticks for the current time
 * @private
 * @type {number}
 */
let _ticksForCurrentTime = 0;
/**
 * Remember the last time when a ticks for the current time so that it can be reset
 * @private
 * @type {number}
 */
let _lastTimestamp = 0;

function writeTime(buffer, time, ticks) {
    // value time expressed in ticks precision
    const val = Long
    .fromNumber(time + _unixToGregorian)
    .multiply(Long.fromNumber(10000))
    .add(Long.fromNumber(ticks));
    const timeHigh = val.getHighBitsUnsigned();
    buffer.writeUInt32BE(val.getLowBitsUnsigned(), 0);
    buffer.writeUInt16BE(timeHigh & 0xffff, 4);
    buffer.writeUInt16BE(timeHigh >>> 16 & 0xffff, 6);
}

function getRandomBytes(length) {
    return crypto.randomBytes(length);
}

/**
 * Returns a buffer of length 2 representing the clock identifier
 * @param {string|Buffer} clockId
 * @return {Buffer}
 * @private
 */
function getClockId(clockId) {
    let buffer = clockId;
    if (typeof clockId === 'string') {
        buffer = Buffer.from(clockId, 'ascii');
    }
    if (!(buffer instanceof Buffer)) {
    // Generate
        buffer = getRandomBytes(2);
    } else if (buffer.length !== 2) {
        throw new Error('Clock identifier must have 2 bytes');
    }
    return buffer;
}

/**
 * Returns a buffer of length 6 representing the clock identifier
 * @param {string|Buffer} nodeId
 * @return {Buffer}
 * @private
 */
function getNodeId(nodeId) {
    let buffer = nodeId;
    if (typeof nodeId === 'string') {
        buffer = Buffer.from(nodeId, 'ascii');
    }
    if (!(buffer instanceof Buffer)) {
    // Generate
        buffer = getRandomBytes(6);
    } else if (buffer.length !== 6) {
        throw new Error('Node identifier must have 6 bytes');
    }
    return buffer;
}

/**
 * Returns the ticks portion of a timestamp.
 * If the ticks are not provided an internal counter is used that gets reset at 10000.
 * @private
 * @param {number} [ticks]
 * @return {number}
 */
function getTicks(ticks) {
    if (typeof ticks !== 'number' || ticks >= _ticksInMs) {
        _ticks++;
        if (_ticks >= _ticksInMs) {
            _ticks = 0;
        }
        ticks = _ticks;
    }
    return ticks;
}

/**
 * Returns an object with the time representation of the date expressed
 * in milliseconds since unix epoch
 * and a ticks property for the 100-nanoseconds precision.
 * @private
 * @return {{time: number, ticks: number}}
 */
function getTimeWithTicks(date, ticks) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
    // time with ticks for the current time
        date = new Date();
        const time = date.getTime();
        _ticksForCurrentTime++;
        if (_ticksForCurrentTime > _ticksInMs || time > _lastTimestamp) {
            _ticksForCurrentTime = 0;
            _lastTimestamp = time;
        }
        ticks = _ticksForCurrentTime;
    }
    return {
        time: date.getTime(),
        ticks: getTicks(ticks)
    };
}

/**
 * Generates a 16-length Buffer instance
 * @private
 * @param {Date} date
 * @param {number} ticks
 * @param {string|Buffer} nodeId
 * @param {string|Buffer} clockId
 * @return {Buffer}
 */
function generateBuffer(date, ticks, nodeId, clockId) {
    const timeWithTicks = getTimeWithTicks(date, ticks);
    nodeId = getNodeId(nodeId);
    clockId = getClockId(clockId);
    const buffer = Buffer.allocUnsafe(16);
    // Positions 0-7 Timestamp
    writeTime(buffer, timeWithTicks.time, timeWithTicks.ticks);
    // Position 8-9 Clock
    clockId.copy(buffer, 8, 0);
    // Positions 10-15 Node
    nodeId.copy(buffer, 10, 0);
    // Version Byte: Time based
    // 0001xxxx
    // turn off first 4 bits
    buffer[6] &= 0x0f;
    // turn on fifth bit
    buffer[6] |= 0x10;

    // IETF Variant Byte: 1.0.x
    // 10xxxxxx
    // turn off first 2 bits
    buffer[8] &= 0x3f;
    // turn on first bit
    buffer[8] |= 0x80;
    return buffer;
}

const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

class TimeUuid extends Uuid {
    /**
     * Creates a new instance of Uuid based on the parameters provided according to rfc4122.
     * If any of the arguments is not provided, it will be randomly generated,
     * except for the date that will use the current date.
     * @class
     * @classdesc Represents an immutable version 1 universally unique identifier (UUID).
     * A UUID represents a 128-bit value.
     * <p>Usage: <code>TimeUuid.now()</code></p>
     * @extends module:types~Uuid
     * @param {Date} [value] The datetime for the instance, if not provided,
     * it will use the current Date.
     * @param {number} [ticks] A number from 0 to 10000 representing the 100-nanoseconds units
     * for this instance to fill in the information not available in the Date,
     * as Ecmascript Dates have only milliseconds precision.
     * @param {string|Buffer} [nodeId] A 6-length Buffer or string of 6 ascii characters
     * representing the node identifier, ie: 'host01'.
     * @param {string|Buffer} [clockId] A 2-length Buffer or string of 6 ascii characters
     * representing the clock identifier.
     * @class
     */
    constructor(value, ticks, nodeId, clockId) {
        let buffer;
        if (value instanceof Buffer) {
            if (value.length !== 16) {
                throw new Error('Buffer for v1 uuid not valid');
            }
            buffer = value;
        } else {
            buffer = generateBuffer(value, ticks, nodeId, clockId);
        }
        super(buffer);
    }

    /**
     * Gets the Date and 100-nanoseconds units representation of this instance.
     * @return {{date: Date, ticks: number}}
     */
    getDatePrecision() {
        const timeLow = this.buffer.readUInt32BE(0);

        let timeHigh = 0;
        timeHigh |= (this.buffer[4] & 0xff) << 8;
        timeHigh |= this.buffer[5] & 0xff;
        timeHigh |= (this.buffer[6] & 0x0f) << 24;
        timeHigh |= (this.buffer[7] & 0xff) << 16;

        const val = Long.fromBits(timeLow, timeHigh);
        const ticksInMsLong = Long.fromNumber(_ticksInMs);
        const ticks = val.modulo(ticksInMsLong);
        const time = val
            .div(ticksInMsLong)
            .subtract(Long.fromNumber(_unixToGregorian));
        return { date: new Date(time.toNumber()), ticks: ticks.toNumber() };
    }

    /**
     * Gets the Date representation of this instance.
     * @return {Date}
     */
    getDate() {
        return this.getDatePrecision().date;
    }

    /**
     * Returns the node id this instance
     * @return {Buffer}
     */
    getNodeId() {
        return this.buffer.slice(10);
    }

    /**
     * Returns the node id this instance as an ascii string
     * @return {string}
     */
    getNodeIdString() {
        return this.buffer.slice(10).toString('ascii');
    }

    /**
     * Generates a TimeUuid instance based on the Date provided using random node and clock values.
     * @param {Date} date Date to generate the v1 uuid.
     * @param {number} [ticks] A number from 0 to 10000 representing the 100-nanoseconds units
     * for this instance to fill in the information not available in the Date,
     * as Ecmascript Dates have only milliseconds precision.
     * @param {string|Buffer} [nodeId] A 6-length Buffer or string of 6 ascii characters
     * representing the node identifier,ie: 'host01'.
     * If not provided, a random nodeId will be generated.
     * @param {string|Buffer} [clockId] A 2-length Buffer or string of 6 ascii characters
     * representing the clock identifier.
     * If not provided a random clockId will be generated.
     */
    static fromDate(date, ticks, nodeId, clockId) {
        return new TimeUuid(date, ticks, nodeId, clockId);
    }

    /**
     * Parses a string representation of a TimeUuid
     * @param {string} value
     * @return {TimeUuid}
     */
    static fromString(value) {
        return new TimeUuid(Uuid.fromString(value).getBuffer());
    }

    /**
     * Returns the smaller possible type 1 uuid with the provided Date.
     */
    static min(date, ticks) {
        return new TimeUuid(
            date, ticks, Buffer.from('808080808080', 'hex'), Buffer.from('8080', 'hex'));
    }

    /**
     * Returns the biggest possible type 1 uuid with the provided Date.
     */
    static max(date, ticks) {
        return new TimeUuid(
            date, ticks, Buffer.from('7f7f7f7f7f7f', 'hex'), Buffer.from('7f7f', 'hex'));
    }

    /**
     * Generates a TimeUuid instance based on the current date using random node and clock values.
     * @param {string|Buffer} [nodeId] A 6-length Buffer or string of 6 ascii characters
     * representing the node identifier, ie: 'host01'.
     * If not provided, a random nodeId will be generated.
     * @param {string|Buffer} [clockId] A 2-length Buffer or string of 6 ascii characters
     * representing the clock identifier.
     * If not provided a random clockId will be generated.
     */
    static now(nodeId, clockId) {
        return new TimeUuid(null, null, nodeId, clockId);
    }

    /**
     * Tests if a given string is a valid v1 UUID
     * @param {string} s a uuid string to test.
     * @return {boolean} true if the given string is a v1 UUID, false otherwise
     */
    static test(s) {
        return uuidRe.test(s);
    }
}

module.exports = TimeUuid;
