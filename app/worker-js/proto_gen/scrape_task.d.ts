import * as $protobuf from "protobufjs";
import Long = require("long");
/** Properties of a ScrapeTask. */
export interface IScrapeTask {

    /** ScrapeTask url */
    url?: (string|null);

    /** ScrapeTask method */
    method?: (string|null);

    /** ScrapeTask headers */
    headers?: ({ [k: string]: string }|null);

    /** ScrapeTask params */
    params?: ({ [k: string]: string }|null);

    /** ScrapeTask body */
    body?: (string|null);
}

/** Represents a ScrapeTask. */
export class ScrapeTask implements IScrapeTask {

    /**
     * Constructs a new ScrapeTask.
     * @param [properties] Properties to set
     */
    constructor(properties?: IScrapeTask);

    /** ScrapeTask url. */
    public url: string;

    /** ScrapeTask method. */
    public method: string;

    /** ScrapeTask headers. */
    public headers: { [k: string]: string };

    /** ScrapeTask params. */
    public params: { [k: string]: string };

    /** ScrapeTask body. */
    public body: string;

    /**
     * Creates a new ScrapeTask instance using the specified properties.
     * @param [properties] Properties to set
     * @returns ScrapeTask instance
     */
    public static create(properties?: IScrapeTask): ScrapeTask;

    /**
     * Encodes the specified ScrapeTask message. Does not implicitly {@link ScrapeTask.verify|verify} messages.
     * @param message ScrapeTask message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: IScrapeTask, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Encodes the specified ScrapeTask message, length delimited. Does not implicitly {@link ScrapeTask.verify|verify} messages.
     * @param message ScrapeTask message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encodeDelimited(message: IScrapeTask, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a ScrapeTask message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns ScrapeTask
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): ScrapeTask;

    /**
     * Decodes a ScrapeTask message from the specified reader or buffer, length delimited.
     * @param reader Reader or buffer to decode from
     * @returns ScrapeTask
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): ScrapeTask;

    /**
     * Verifies a ScrapeTask message.
     * @param message Plain object to verify
     * @returns `null` if valid, otherwise the reason why it is not
     */
    public static verify(message: { [k: string]: any }): (string|null);

    /**
     * Creates a ScrapeTask message from a plain object. Also converts values to their respective internal types.
     * @param object Plain object
     * @returns ScrapeTask
     */
    public static fromObject(object: { [k: string]: any }): ScrapeTask;

    /**
     * Creates a plain object from a ScrapeTask message. Also converts values to other types if specified.
     * @param message ScrapeTask
     * @param [options] Conversion options
     * @returns Plain object
     */
    public static toObject(message: ScrapeTask, options?: $protobuf.IConversionOptions): { [k: string]: any };

    /**
     * Converts this ScrapeTask to JSON.
     * @returns JSON object
     */
    public toJSON(): { [k: string]: any };

    /**
     * Gets the default type url for ScrapeTask
     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
     * @returns The default type url
     */
    public static getTypeUrl(typeUrlPrefix?: string): string;
}
