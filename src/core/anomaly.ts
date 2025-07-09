type AnomalyCategory =
    | 'unavailable'
    | 'interrupted'
    | 'busy'
    | 'incorrect'
    | 'forbidden'
    | 'unsupported'
    | 'not-found'
    | 'conflict'
    | 'fault';

type AnomalyOptions = {
    message?: string;
    metadata?: Record<string, unknown>;
};

type MaybeRetryableAnomalyOptions = AnomalyOptions & {
    retryable?: boolean;
};

class Anomaly extends Error {
    public readonly category: AnomalyCategory;
    public readonly retryable: boolean;
    public readonly metadata?: Record<string, unknown>;

    constructor(
        category: AnomalyCategory,
        message?: string,
        retryable?: boolean,
        metadata?: Record<string, unknown>,
    ) {
        const defaultMessage = getDefaultMessage(category);
        super(message || defaultMessage);

        this.name = 'Anomaly';
        this.category = category;
        this.retryable = retryable || getRetryable(category);
        this.metadata = metadata;
    }
}

export class UnavailableAnomaly extends Anomaly {
    constructor(options?: AnomalyOptions) {
        super('unavailable', options?.message, undefined, options?.metadata);
    }
}

export class InterruptedAnomaly extends Anomaly {
    constructor(options?: MaybeRetryableAnomalyOptions) {
        super(
            'interrupted',
            options?.message,
            options?.retryable,
            options?.metadata,
        );
    }
}

export class BusyAnomaly extends Anomaly {
    constructor(options?: AnomalyOptions) {
        super('busy', options?.message, undefined, options?.metadata);
    }
}

export class IncorrectAnomaly extends Anomaly {
    constructor(options?: AnomalyOptions) {
        super('incorrect', options?.message, undefined, options?.metadata);
    }
}

export class ForbiddenAnomaly extends Anomaly {
    constructor(options?: AnomalyOptions) {
        super('forbidden', options?.message, undefined, options?.metadata);
    }
}

export class UnsupportedAnomaly extends Anomaly {
    constructor(options?: AnomalyOptions) {
        super('unsupported', options?.message, undefined, options?.metadata);
    }
}

export class NotFoundAnomaly extends Anomaly {
    constructor(options?: AnomalyOptions) {
        super('not-found', options?.message, undefined, options?.metadata);
    }
}

export class ConflictAnomaly extends Anomaly {
    constructor(options?: AnomalyOptions) {
        super('conflict', options?.message, undefined, options?.metadata);
    }
}

export class FaultAnomaly extends Anomaly {
    constructor(options?: MaybeRetryableAnomalyOptions) {
        super('fault', options?.message, options?.retryable, options?.metadata);
    }
}

function getDefaultMessage(category: AnomalyCategory): string {
    switch (category) {
        case 'unavailable':
            return 'Service is unavailable';
        case 'interrupted':
            return 'Operation was interrupted';
        case 'busy':
            return 'Service is busy';
        case 'incorrect':
            return 'Request is incorrect';
        case 'forbidden':
            return 'Access forbidden';
        case 'unsupported':
            return 'Operation not supported';
        case 'not-found':
            return 'Resource not found';
        case 'conflict':
            return 'Request conflicts with current state';
        case 'fault':
            return 'Internal service fault';
    }
}

function getRetryable(category: AnomalyCategory): boolean {
    switch (category) {
        case 'unavailable':
        case 'busy':
            return true;
        case 'interrupted':
        case 'fault':
            // "Maybe" results are false by default, but overridable on construction
            return false;
        case 'incorrect':
        case 'forbidden':
        case 'unsupported':
        case 'not-found':
        case 'conflict':
            return false;
    }
}
