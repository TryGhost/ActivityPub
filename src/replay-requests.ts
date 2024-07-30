import app from './app';
import * as path from 'path';
import * as fs from 'fs';

if (process.env.REPLAY_REQUESTS === 'true') {
    const filePath = path.join(import.meta.dirname, '../', 'inbox-requests.json');
    const file = fs.readFileSync(filePath);
    const lines = file.toString('utf8').split('\n');

    for (const line of lines) {
        try {
    	if (line) {
    	    const obj = JSON.parse(line);
    	    const request = new Request(obj.input, obj.init);
    	    console.log('Replaying request', obj);
    	    await app.request(request);
    	}
        } catch (err) {
    	console.error(err);
        }
    }

    process.exit(0);
}
