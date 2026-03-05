export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER_TOKEN';

export interface WhatsappProvider {
    sendTextMessage(to: string, body: string): Promise<void>;
    sendContentMessage(to: string, contentSid: string, variables?: any): Promise<void>;
    sendTypingIndicator(to: string): Promise<void>;
    parseIncomingWebhook(body: any): Promise<{ sender: string; message: string; mediaUrl?: string; mediaContentType?: string; interactiveData?: any }>;
    downloadMedia(mediaUrl: string): Promise<Buffer>;
}
