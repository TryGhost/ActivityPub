export interface ActivityObjectAttachment {
    type: string;
    mediaType: string;
    name: string;
    url: string;
}

export interface ActivityObject {
    id: string;
    content: string;
    attachment?: ActivityObjectAttachment | ActivityObjectAttachment[];
    // TODO: Clean up the any type
    // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
    [key: string]: any;
}

export interface Activity {
    id: string;
    object: string | ActivityObject;
    // TODO: Clean up the any type
    // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
    [key: string]: any;
}
