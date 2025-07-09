import { describe, expect, it } from 'vitest';
import {
    BusyAnomaly,
    ConflictAnomaly,
    FaultAnomaly,
    ForbiddenAnomaly,
    IncorrectAnomaly,
    InterruptedAnomaly,
    NotFoundAnomaly,
    UnavailableAnomaly,
    UnsupportedAnomaly,
} from './anomaly';

describe('Anomalies', () => {
    describe('Specific anomaly classes', () => {
        it('should create UnavailableAnomaly correctly', () => {
            const anomaly = new UnavailableAnomaly();
            expect(anomaly).toMatchObject({
                category: 'unavailable',
                message: 'Service is unavailable',
                retryable: true,
            });
        });

        it('should create InterruptedAnomaly correctly', () => {
            const anomaly = new InterruptedAnomaly({
                message: 'Custom interrupted message',
            });
            expect(anomaly).toMatchObject({
                category: 'interrupted',
                message: 'Custom interrupted message',
                retryable: false,
            });
        });

        it('should create BusyAnomaly correctly', () => {
            const anomaly = new BusyAnomaly();
            expect(anomaly).toMatchObject({
                category: 'busy',
                retryable: true,
            });
        });

        it('should create IncorrectAnomaly correctly', () => {
            const anomaly = new IncorrectAnomaly();
            expect(anomaly).toMatchObject({
                category: 'incorrect',
                retryable: false,
            });
        });

        it('should create ForbiddenAnomaly correctly', () => {
            const anomaly = new ForbiddenAnomaly();
            expect(anomaly).toMatchObject({
                category: 'forbidden',
                retryable: false,
            });
        });

        it('should create UnsupportedAnomaly correctly', () => {
            const anomaly = new UnsupportedAnomaly();
            expect(anomaly).toMatchObject({
                category: 'unsupported',
                retryable: false,
            });
        });

        it('should create NotFoundAnomaly correctly', () => {
            const anomaly = new NotFoundAnomaly();
            expect(anomaly).toMatchObject({
                category: 'not-found',
                retryable: false,
            });
        });

        it('should create ConflictAnomaly correctly', () => {
            const anomaly = new ConflictAnomaly();
            expect(anomaly).toMatchObject({
                category: 'conflict',
                retryable: false,
            });
        });

        it('should create FaultAnomaly correctly', () => {
            const anomaly = new FaultAnomaly();
            expect(anomaly).toMatchObject({
                category: 'fault',
                retryable: false,
            });
        });
    });

    describe('Edge cases', () => {
        it('should use default messages when no custom message provided', () => {
            const anomaly = new UnavailableAnomaly();
            expect(anomaly.message).toBe('Service is unavailable');
        });

        it('should test all anomaly types with custom messages', () => {
            const optionsWithMessage = { message: 'Custom test message' };
            const anomalies = [
                new UnavailableAnomaly(optionsWithMessage),
                new InterruptedAnomaly(optionsWithMessage),
                new BusyAnomaly(optionsWithMessage),
                new IncorrectAnomaly(optionsWithMessage),
                new ForbiddenAnomaly(optionsWithMessage),
                new UnsupportedAnomaly(optionsWithMessage),
                new NotFoundAnomaly(optionsWithMessage),
                new ConflictAnomaly(optionsWithMessage),
                new FaultAnomaly(optionsWithMessage),
            ];

            for (const anomaly of anomalies) {
                expect(anomaly).toMatchObject(optionsWithMessage);
            }
        });

        it('should allow overriding retryable for InterruptedAnomaly', () => {
            const defaultInterrupted = new InterruptedAnomaly();
            expect(defaultInterrupted.retryable).toBe(false);

            const retryableInterrupted = new InterruptedAnomaly({
                message: 'Custom message',
                retryable: true,
            });
            expect(retryableInterrupted.retryable).toBe(true);

            const nonRetryableInterrupted = new InterruptedAnomaly({
                message: 'Custom message',
                retryable: false,
            });
            expect(nonRetryableInterrupted.retryable).toBe(false);
        });

        it('should allow overriding retryable for FaultAnomaly', () => {
            const defaultFault = new FaultAnomaly();
            expect(defaultFault.retryable).toBe(false);

            const retryableFault = new FaultAnomaly({
                message: 'Custom message',
                retryable: true,
            });
            expect(retryableFault.retryable).toBe(true);

            const nonRetryableFault = new FaultAnomaly({
                message: 'Custom message',
                retryable: false,
            });
            expect(nonRetryableFault.retryable).toBe(false);
        });
    });
});
