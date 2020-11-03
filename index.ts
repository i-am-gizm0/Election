import express from 'express';
import cheerio from 'cheerio';
import fetch from 'node-fetch';
import { parseDate } from 'chrono-node';
import cron from 'node-cron';
import readline from 'readline';

import config from './config.json';

const app = express();
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let cachedData: {
    college: {
        biden: number;
        trump: number;
        remaining: number;
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

    const collegeRemaining = parseInt($(config.remote.college.remaining).text());

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
            trump: trumpCollege,
            remaining: collegeRemaining
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
    ask();
});

function ask() {
    rl.question('\n', answer => {
        if (answer == 'stop') {
            shutdown(true);
        } else if (answer == 'restart') {
            shutdown(false);
        } else if (answer == 'update disable') {
            schedule.stop();
        } else if (answer == 'update enable') {
            schedule.start();
        }
        ask();
    });
}

app.get('/', async (req, res) => {
    console.log(`\n-> ${req.method} ${req.url}`);
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
    console.log(`\n-> ${req.method} ${req.url}`);
    console.time(`response`);

    if (new Date().getTime() - cachedData.source.cacheTimestamp > 5000) {

        res.contentType('application/json');

        await updateData();

        res.status(201);
        res.send(cachedData);
    } else {
        res.status(304);
        res.setHeader('Location', '/');
        res.send();
    }

    console.timeEnd(`response`);
    console.log(`<- ${res.statusCode}`);
});

app.get('/ping', (req, res) => {
    res.send('OK');
});

app.get('/*', (req, res) => {
    console.log(`\n-> ${req.method} ${req.url}`);
    res.status(404);
    res.send('Not Found');
    console.log(`<- ${res.statusCode}`);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown(really?:boolean) {
    console.log('Shutdown signal received');
    schedule.destroy();
    console.log('Updates stopped');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(really ? 1 : 0);
    });
}