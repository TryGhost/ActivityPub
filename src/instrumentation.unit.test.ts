import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { createServer, type Server } from 'node:http';
import { type AddressInfo, connect } from 'node:net';

import type { Logger } from '@logtape/logtape';
import { context, propagation, trace } from '@opentelemetry/api';
import * as Sentry from '@sentry/node';

import { setupInstrumentation } from '@/instrumentation';

describe('setupInstrumentation', () => {
    let server: Server;
    let port: number;
    let sentEvents: Sentry.Event[];

    // Requests made with fetch or node:http from this process would be traced
    // by Sentry as outgoing requests, a raw socket behaves like a remote client
    function requestFromRemoteClient(head: string[], body = '') {
        return new Promise<void>((resolve, reject) => {
            const socket = connect(port, '127.0.0.1', () => {
                socket.end(
                    `${[...head, 'Host: activitypub.test', 'Connection: close'].join('\r\n')}\r\n\r\n${body}`,
                );
            });
            socket.on('error', reject);
            socket.on('close', () => resolve());
            socket.resume();
        });
    }

    function sentTransaction(name: string) {
        return sentEvents.find(
            (event) =>
                event.type === 'transaction' && event.transaction === name,
        );
    }

    beforeAll(async () => {
        vi.stubEnv('SENTRY_DSN', 'https://key@sentry.invalid/1');

        setupInstrumentation({} as unknown as Logger);

        const client = Sentry.getClient()!;
        vi.spyOn(client.getTransport()!, 'send').mockResolvedValue({});
        client.on('beforeSendEvent', (event) => {
            sentEvents.push(event);
        });

        server = createServer((req, res) => {
            req.on('data', () => {});
            req.on('end', () => {
                res.statusCode = req.url === '/missing' ? 404 : 200;
                res.end();
            });
        });
        await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve),
        );
        port = (server.address() as AddressInfo).port;
    });

    beforeEach(() => {
        sentEvents = [];
    });

    afterAll(async () => {
        await new Promise((resolve) => server.close(resolve));
        await Sentry.close();
        vi.unstubAllEnvs();
    });

    it('records spans created through the OpenTelemetry API', () => {
        Sentry.startSpan({ name: 'parent' }, (parent) => {
            const span = trace.getTracer('test').startSpan('child');

            expect(span.isRecording()).toBe(true);
            expect(span.spanContext().traceId).toBe(
                parent.spanContext().traceId,
            );

            span.end();
        });
    });

    it('propagates the active trace through the OpenTelemetry API', () => {
        Sentry.startSpan({ name: 'parent' }, (parent) => {
            const carrier: Record<string, string> = {};

            propagation.inject(context.active(), carrier);

            const { traceId, spanId } = parent.spanContext();
            expect(carrier['sentry-trace']).toBe(`${traceId}-${spanId}-1`);
            expect(carrier.baggage).toContain(`sentry-trace_id=${traceId}`);
        });
    });

    it('names the transaction of an incoming request after its method and path', async () => {
        await requestFromRemoteClient(['GET /users/alice?page=2 HTTP/1.1']);

        await vi.waitFor(() => {
            expect(sentTransaction('GET /users/alice')).toBeDefined();
        });
        const transaction = sentTransaction('GET /users/alice')!;
        // Sentry rewrites the names of transactions with a `url` source
        expect(transaction.transaction_info?.source).toBe('custom');
        expect(transaction.contexts?.trace?.data?.['service.name']).toBe(
            'activitypub',
        );
        expect(transaction.contexts?.trace?.data?.['http.route']).toBe(
            '/users/alice',
        );
    });

    it('sends the body of an incoming request', async () => {
        const body = '{"type":"Follow"}';

        await requestFromRemoteClient(
            [
                'POST /inbox HTTP/1.1',
                'Content-Type: application/json',
                `Content-Length: ${body.length}`,
            ],
            body,
        );

        await vi.waitFor(() => {
            expect(sentTransaction('POST /inbox')).toBeDefined();
        });
        expect(sentTransaction('POST /inbox')!.request?.data).toBe(body);
    });

    it('sends the site a request was for but not the client it came from', async () => {
        await requestFromRemoteClient([
            'GET /outbox HTTP/1.1',
            'X-Forwarded-Host: site.example',
            'X-Forwarded-For: 203.0.113.7',
        ]);

        await vi.waitFor(() => {
            expect(sentTransaction('GET /outbox')).toBeDefined();
        });
        const transaction = sentTransaction('GET /outbox')!;
        expect(transaction.request?.headers?.['x-forwarded-host']).toBe(
            'site.example',
        );
        expect(transaction.request?.headers?.['x-forwarded-for']).toBe(
            undefined,
        );
        expect(
            transaction.contexts?.trace?.data?.[
                'http.request.header.x-forwarded-for'
            ],
        ).toEqual(['[Filtered]']);
        expect(transaction.user).toBe(undefined);
    });

    it('does not send a transaction for a request that was not found', async () => {
        await requestFromRemoteClient(['GET /missing HTTP/1.1']);
        await requestFromRemoteClient(['GET /found HTTP/1.1']);

        await vi.waitFor(() => {
            expect(sentTransaction('GET /found')).toBeDefined();
        });
        expect(sentTransaction('GET /missing')).toBe(undefined);
    });
});
