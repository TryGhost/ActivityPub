import { Context, Next } from 'hono';
import { FileHandle, open } from 'fs/promises';

type JSONRequest = {
    input: string
    init: RequestInit
}

export class RequestRecorder {
    private constructor(private readonly file: FileHandle) {}

    async recordRequest(req: Request): Promise<void> {
        try {
            const json = await this.requestToJSON(req);
            this.file.appendFile(JSON.stringify(json) + '\n');
        } catch (err) {
            console.error('Could not write JSON');
        }
    }

    async honoMiddleware(ctx: Context<any>, next: Next) {
        this.recordRequest(ctx.req.raw);
        await next();
    }

    async requestToJSON(request: Request): Promise<JSONRequest> {
        const req = request.clone();
        const body = await new Response(req.body).text();
        return {
            input: req.url,
            init: {
                body: body,
                headers: Object.fromEntries(req.headers.entries()),
                method: req.method
            }
        };
    }

    static async create(path: string): Promise<RequestRecorder> {
        const file = await open(path, 'a');
        return new RequestRecorder(file);
    }
}
