import express from 'express';
import cheerio from 'cheerio';
import fetch from 'node-fetch';
import { parseDate } from 'chrono-node';
import cron from 'node-cron';

import config from './config.json';

const app = express();

let cachedData: {
    college: {
        biden: number;
        trump: number;
    };
    popular: {
        biden: number;
        trump: number;
    };
    states: any;
    source: {
        url: string;
        updated: number;
        cacheTimestamp: number;
    };
};
let requestsSinceLastUpdate = 0;

async function updateData() {
    console.log('Updating cache');
    let cacheTimestamp = new Date();

    console.time('fetch');
    const response = await fetch(config.remote.url);
    const html = await response.text();
    console.timeEnd('fetch');

    console.time('parse');
    const $ = cheerio.load(html);

    const bidenCollege = parseInt($(config.remote.college.biden).text().split('\n')[1]);
    const bidenPopular = parseInt($(config.remote.popular.biden).text().substr(11).replace(/,/g, ''));

    const trumpCollege = parseInt($(config.remote.college.trump).text().split('\n')[1]);
    const trumpPopular = parseInt($(config.remote.popular.trump).text().substr(11).replace(/,/g, ''));

    // <USA TODAY SPECIFIC>
    const map = $('#regions');
    const stateData:any = {};
    map.children().each((i, element) => {
        if (element.attribs['data-n'] && element.attribs['fill']) {
            let color = element.attribs.fill;
            let data: 'biden' | 'trump' | 'tied' | 'in-progress' | 'no-results' | 'unknown';
            switch (color) {
                case '#1665cf':
                    data = 'biden';
                    break;
                
                case '#cd2d37':
                    data = 'trump';
                    break;

                case '#d78401':
                    data = 'tied';
                    break;
                
                case 'url(#inProgress)':
                    data = 'in-progress';
                    break;
                
                case '#a4a4a4':
                    data = 'no-results';
                    break;
                
                default:
                    data = 'unknown';
            }
            stateData[element.attribs['data-n']] = data;
        }
    });

    let updated:Date;
    try {
        updated = parseDate($('.results-president-bop-date').text());
    } catch (e) {
        console.warn(e);
    }
    // </USA TODAY SPECIFIC>

    console.timeEnd('parse');

    cachedData = {
        college: {
            biden: bidenCollege,
            trump: trumpCollege
        },
        popular: {
            biden: bidenPopular,
            trump: trumpPopular
        },
        states: stateData,
        source: {
            url: config.remote.url,
            updated: updated.getTime(),
            cacheTimestamp: cacheTimestamp.getTime()
        }
    }
    console.log('Cached data:', cachedData);
}

console.log(`Caching and setting schedule of ${config.cacheSchedule}`);
let schedule = cron.schedule(config.cacheSchedule, updateData);
updateData();

console.log('Starting server...');
const server = app.listen(parseInt(config.server.port), config.server.address, () => {
    console.log(`Listening on ${config.server.address}:${config.server.port}`);
});

app.get('/', async (req, res) => {
    console.log(`-> ${req.method} ${req.url}`);
    console.time(`response`);
    res.contentType('application/json');

    if (cachedData) {
        res.send(cachedData);
    } else {
        res.status(503);
        res.send({error: '503 service unavailable\nthe server is not ready to handle your request'});
    }

    console.timeEnd(`response`);
    console.log(`<- ${res.statusCode}`);
});

app.get('/force', async (req, res) => {
    console.log(`-> ${req.method} ${req.url}`);
    console.time(`response`);
    res.contentType('application/json');

    await updateData();

    res.status(201);
    res.send(cachedData);

    console.timeEnd(`response`);
    console.log(`<- ${res.statusCode}`);
});

app.get('/ping', (req, res) => {
    res.send('OK');
});

app.get('/*', (req, res) => {
    console.log(`-> ${req.method} ${req.url}`);
    res.status(404);
    res.send('Not Found');
    console.log(`<- ${res.statusCode}`);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
    console.log('Shutdown signal received');
    schedule.destroy();
    console.log('Updates stopped');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
}