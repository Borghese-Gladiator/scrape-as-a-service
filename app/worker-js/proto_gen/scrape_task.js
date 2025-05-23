/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
"use strict";

var $protobuf = require("protobufjs/minimal");

// Common aliases
var $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
var $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

$root.ScrapeTask = (function() {

    /**
     * Properties of a ScrapeTask.
     * @exports IScrapeTask
     * @interface IScrapeTask
     * @property {string|null} [jobId] ScrapeTask jobId
     * @property {string|null} [url] ScrapeTask url
     * @property {string|null} [method] ScrapeTask method
     * @property {Object.<string,string>|null} [headers] ScrapeTask headers
     * @property {Object.<string,string>|null} [params] ScrapeTask params
     * @property {string|null} [body] ScrapeTask body
     */

    /**
     * Constructs a new ScrapeTask.
     * @exports ScrapeTask
     * @classdesc Represents a ScrapeTask.
     * @implements IScrapeTask
     * @constructor
     * @param {IScrapeTask=} [properties] Properties to set
     */
    function ScrapeTask(properties) {
        this.headers = {};
        this.params = {};
        if (properties)
            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * ScrapeTask jobId.
     * @member {string} jobId
     * @memberof ScrapeTask
     * @instance
     */
    ScrapeTask.prototype.jobId = "";

    /**
     * ScrapeTask url.
     * @member {string} url
     * @memberof ScrapeTask
     * @instance
     */
    ScrapeTask.prototype.url = "";

    /**
     * ScrapeTask method.
     * @member {string} method
     * @memberof ScrapeTask
     * @instance
     */
    ScrapeTask.prototype.method = "";

    /**
     * ScrapeTask headers.
     * @member {Object.<string,string>} headers
     * @memberof ScrapeTask
     * @instance
     */
    ScrapeTask.prototype.headers = $util.emptyObject;

    /**
     * ScrapeTask params.
     * @member {Object.<string,string>} params
     * @memberof ScrapeTask
     * @instance
     */
    ScrapeTask.prototype.params = $util.emptyObject;

    /**
     * ScrapeTask body.
     * @member {string} body
     * @memberof ScrapeTask
     * @instance
     */
    ScrapeTask.prototype.body = "";

    /**
     * Creates a new ScrapeTask instance using the specified properties.
     * @function create
     * @memberof ScrapeTask
     * @static
     * @param {IScrapeTask=} [properties] Properties to set
     * @returns {ScrapeTask} ScrapeTask instance
     */
    ScrapeTask.create = function create(properties) {
        return new ScrapeTask(properties);
    };

    /**
     * Encodes the specified ScrapeTask message. Does not implicitly {@link ScrapeTask.verify|verify} messages.
     * @function encode
     * @memberof ScrapeTask
     * @static
     * @param {IScrapeTask} message ScrapeTask message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    ScrapeTask.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.jobId != null && Object.hasOwnProperty.call(message, "jobId"))
            writer.uint32(/* id 1, wireType 2 =*/10).string(message.jobId);
        if (message.url != null && Object.hasOwnProperty.call(message, "url"))
            writer.uint32(/* id 2, wireType 2 =*/18).string(message.url);
        if (message.method != null && Object.hasOwnProperty.call(message, "method"))
            writer.uint32(/* id 3, wireType 2 =*/26).string(message.method);
        if (message.headers != null && Object.hasOwnProperty.call(message, "headers"))
            for (var keys = Object.keys(message.headers), i = 0; i < keys.length; ++i)
                writer.uint32(/* id 4, wireType 2 =*/34).fork().uint32(/* id 1, wireType 2 =*/10).string(keys[i]).uint32(/* id 2, wireType 2 =*/18).string(message.headers[keys[i]]).ldelim();
        if (message.params != null && Object.hasOwnProperty.call(message, "params"))
            for (var keys = Object.keys(message.params), i = 0; i < keys.length; ++i)
                writer.uint32(/* id 5, wireType 2 =*/42).fork().uint32(/* id 1, wireType 2 =*/10).string(keys[i]).uint32(/* id 2, wireType 2 =*/18).string(message.params[keys[i]]).ldelim();
        if (message.body != null && Object.hasOwnProperty.call(message, "body"))
            writer.uint32(/* id 6, wireType 2 =*/50).string(message.body);
        return writer;
    };

    /**
     * Encodes the specified ScrapeTask message, length delimited. Does not implicitly {@link ScrapeTask.verify|verify} messages.
     * @function encodeDelimited
     * @memberof ScrapeTask
     * @static
     * @param {IScrapeTask} message ScrapeTask message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    ScrapeTask.encodeDelimited = function encodeDelimited(message, writer) {
        return this.encode(message, writer).ldelim();
    };

    /**
     * Decodes a ScrapeTask message from the specified reader or buffer.
     * @function decode
     * @memberof ScrapeTask
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {ScrapeTask} ScrapeTask
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    ScrapeTask.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.ScrapeTask(), key, value;
        while (reader.pos < end) {
            var tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.jobId = reader.string();
                    break;
                }
            case 2: {
                    message.url = reader.string();
                    break;
                }
            case 3: {
                    message.method = reader.string();
                    break;
                }
            case 4: {
                    if (message.headers === $util.emptyObject)
                        message.headers = {};
                    var end2 = reader.uint32() + reader.pos;
                    key = "";
                    value = "";
                    while (reader.pos < end2) {
                        var tag2 = reader.uint32();
                        switch (tag2 >>> 3) {
                        case 1:
                            key = reader.string();
                            break;
                        case 2:
                            value = reader.string();
                            break;
                        default:
                            reader.skipType(tag2 & 7);
                            break;
                        }
                    }
                    message.headers[key] = value;
                    break;
                }
            case 5: {
                    if (message.params === $util.emptyObject)
                        message.params = {};
                    var end2 = reader.uint32() + reader.pos;
                    key = "";
                    value = "";
                    while (reader.pos < end2) {
                        var tag2 = reader.uint32();
                        switch (tag2 >>> 3) {
                        case 1:
                            key = reader.string();
                            break;
                        case 2:
                            value = reader.string();
                            break;
                        default:
                            reader.skipType(tag2 & 7);
                            break;
                        }
                    }
                    message.params[key] = value;
                    break;
                }
            case 6: {
                    message.body = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        return message;
    };

    /**
     * Decodes a ScrapeTask message from the specified reader or buffer, length delimited.
     * @function decodeDelimited
     * @memberof ScrapeTask
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @returns {ScrapeTask} ScrapeTask
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    ScrapeTask.decodeDelimited = function decodeDelimited(reader) {
        if (!(reader instanceof $Reader))
            reader = new $Reader(reader);
        return this.decode(reader, reader.uint32());
    };

    /**
     * Verifies a ScrapeTask message.
     * @function verify
     * @memberof ScrapeTask
     * @static
     * @param {Object.<string,*>} message Plain object to verify
     * @returns {string|null} `null` if valid, otherwise the reason why it is not
     */
    ScrapeTask.verify = function verify(message) {
        if (typeof message !== "object" || message === null)
            return "object expected";
        if (message.jobId != null && message.hasOwnProperty("jobId"))
            if (!$util.isString(message.jobId))
                return "jobId: string expected";
        if (message.url != null && message.hasOwnProperty("url"))
            if (!$util.isString(message.url))
                return "url: string expected";
        if (message.method != null && message.hasOwnProperty("method"))
            if (!$util.isString(message.method))
                return "method: string expected";
        if (message.headers != null && message.hasOwnProperty("headers")) {
            if (!$util.isObject(message.headers))
                return "headers: object expected";
            var key = Object.keys(message.headers);
            for (var i = 0; i < key.length; ++i)
                if (!$util.isString(message.headers[key[i]]))
                    return "headers: string{k:string} expected";
        }
        if (message.params != null && message.hasOwnProperty("params")) {
            if (!$util.isObject(message.params))
                return "params: object expected";
            var key = Object.keys(message.params);
            for (var i = 0; i < key.length; ++i)
                if (!$util.isString(message.params[key[i]]))
                    return "params: string{k:string} expected";
        }
        if (message.body != null && message.hasOwnProperty("body"))
            if (!$util.isString(message.body))
                return "body: string expected";
        return null;
    };

    /**
     * Creates a ScrapeTask message from a plain object. Also converts values to their respective internal types.
     * @function fromObject
     * @memberof ScrapeTask
     * @static
     * @param {Object.<string,*>} object Plain object
     * @returns {ScrapeTask} ScrapeTask
     */
    ScrapeTask.fromObject = function fromObject(object) {
        if (object instanceof $root.ScrapeTask)
            return object;
        var message = new $root.ScrapeTask();
        if (object.jobId != null)
            message.jobId = String(object.jobId);
        if (object.url != null)
            message.url = String(object.url);
        if (object.method != null)
            message.method = String(object.method);
        if (object.headers) {
            if (typeof object.headers !== "object")
                throw TypeError(".ScrapeTask.headers: object expected");
            message.headers = {};
            for (var keys = Object.keys(object.headers), i = 0; i < keys.length; ++i)
                message.headers[keys[i]] = String(object.headers[keys[i]]);
        }
        if (object.params) {
            if (typeof object.params !== "object")
                throw TypeError(".ScrapeTask.params: object expected");
            message.params = {};
            for (var keys = Object.keys(object.params), i = 0; i < keys.length; ++i)
                message.params[keys[i]] = String(object.params[keys[i]]);
        }
        if (object.body != null)
            message.body = String(object.body);
        return message;
    };

    /**
     * Creates a plain object from a ScrapeTask message. Also converts values to other types if specified.
     * @function toObject
     * @memberof ScrapeTask
     * @static
     * @param {ScrapeTask} message ScrapeTask
     * @param {$protobuf.IConversionOptions} [options] Conversion options
     * @returns {Object.<string,*>} Plain object
     */
    ScrapeTask.toObject = function toObject(message, options) {
        if (!options)
            options = {};
        var object = {};
        if (options.objects || options.defaults) {
            object.headers = {};
            object.params = {};
        }
        if (options.defaults) {
            object.jobId = "";
            object.url = "";
            object.method = "";
            object.body = "";
        }
        if (message.jobId != null && message.hasOwnProperty("jobId"))
            object.jobId = message.jobId;
        if (message.url != null && message.hasOwnProperty("url"))
            object.url = message.url;
        if (message.method != null && message.hasOwnProperty("method"))
            object.method = message.method;
        var keys2;
        if (message.headers && (keys2 = Object.keys(message.headers)).length) {
            object.headers = {};
            for (var j = 0; j < keys2.length; ++j)
                object.headers[keys2[j]] = message.headers[keys2[j]];
        }
        if (message.params && (keys2 = Object.keys(message.params)).length) {
            object.params = {};
            for (var j = 0; j < keys2.length; ++j)
                object.params[keys2[j]] = message.params[keys2[j]];
        }
        if (message.body != null && message.hasOwnProperty("body"))
            object.body = message.body;
        return object;
    };

    /**
     * Converts this ScrapeTask to JSON.
     * @function toJSON
     * @memberof ScrapeTask
     * @instance
     * @returns {Object.<string,*>} JSON object
     */
    ScrapeTask.prototype.toJSON = function toJSON() {
        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
    };

    /**
     * Gets the default type url for ScrapeTask
     * @function getTypeUrl
     * @memberof ScrapeTask
     * @static
     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
     * @returns {string} The default type url
     */
    ScrapeTask.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
        if (typeUrlPrefix === undefined) {
            typeUrlPrefix = "type.googleapis.com";
        }
        return typeUrlPrefix + "/ScrapeTask";
    };

    return ScrapeTask;
})();

module.exports = $root;
