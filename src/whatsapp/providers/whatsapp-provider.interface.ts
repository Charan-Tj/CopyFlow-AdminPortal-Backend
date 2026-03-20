export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER_TOKEN';

export interface WhatsappProvider {
    sendTextMessage(to: string, body: string): Promise<void>;
    /**
     * Send a message with up to 3 quick-reply buttons.
     * @param to      recipient
     * @param body    main message body text
     * @param buttons array of { id, label } — max 3
     * @param header  optional header line (bold on Meta, prepended on Telegram)
     * @param footer  optional footer line (dimmed on Meta, appended on Telegram)
     */
    sendButtonMessage(
        to: string,
        body: string,
        buttons: { id: string; label: string }[],
        header?: string,
        footer?: string,
    ): Promise<void>;
    sendContentMessage(to: string, contentSid: string, variables?: any): Promise<void>;
    sendTypingIndicator(to: string): Promise<void>;
    parseIncomingWebhook(body: any): Promise<{ sender: string; message: string; mediaUrl?: string; mediaContentType?: string; interactiveData?: any; userName?: string }>;
    downloadMedia(mediaUrl: string): Promise<Buffer>;
}
