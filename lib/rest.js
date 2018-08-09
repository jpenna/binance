const request = require('request');
const qs = require('querystring');
const crypto = require('crypto');
const Beautifier = require('./beautifier.js');
const assert = require('assert');

class BinanceRest {
    constructor({
        key,
        secret,
        recvWindow = false,
        timeout = 15000,
        beautify = false,
        handleDrift = false
    }) {
        this.key = key;
        this.secret = secret;
        this.recvWindow = recvWindow;
        this.timeout = timeout;
        this.beautify = beautify;
        this.handleDrift = handleDrift;

        this._beautifier = new Beautifier();
        this._baseUrl = 'https://api.binance.com/';
        this._drift = 0;
        this._syncInterval = 0;
    }

    _makeRequest(query, callback, route, security, method, attempt = 0) {
        if (callback) {
            assert(callback instanceof Function, 'callback must be a function or undefined');
        }
        assert(typeof query === 'object', 'query must be an object');

        let queryString;
        const splited = route.split('/');
        const type = splited[splited.length - 1],
            options = {
                url: `${this._baseUrl}${route}?`,
                timeout: this.timeout
            };

        if (security === 'SIGNED') {
            if (this.recvWindow) {
                query.recvWindow = this.recvWindow;
            }
            queryString = qs.stringify(query);
            options.url += queryString;
            options.url += `&signature=${this._sign(queryString)}`;
        } else {
            queryString = qs.stringify(query);
            if (queryString) {
                options.url += queryString;
            }
        }
        if (security === 'API-KEY' || security === 'SIGNED') {
            options.headers = { 'X-MBX-APIKEY': this.key };
        }
        if (method) {
            options.method = method;
        }

        const action = cb => {
            request(options, (err, response, body) => {
                let payload;
                try {
                    payload = JSON.parse(body);
                } catch (e) {
                    payload = body;
                }
                if (err) {
                    cb(err, payload);
                } else if (response.statusCode < 200 || response.statusCode > 299) {
                    /*
                     * If we get a response that the timestamp is ahead of the server,
                     * calculate the drift and then attempt the request again
                     */
                    if (response.statusCode === 400 && payload.code === -1021 &&
                        this.handleDrift && attempt === 0) {

                        this.calculateDrift()
                            .then(() => {
                                query.timestamp = Date.now() + this._drift;
                                return this._makeRequest(query, cb, route, security, method,
                                    ++attempt);
                            });
                    } else {
                        cb(new Error(`Response code ${response.statusCode}`), payload);
                    }
                } else {
                    if (this.beautify) {
                        if (Array.isArray(payload)) {
                            payload = payload.map(item => this._doBeautifications(item, type));
                        } else {
                            payload = this._doBeautifications(payload);
                        }
                    }
                    cb(err, payload);
                }
            });
        };

        if (callback) {
            return action(callback);
        }

        return new Promise((resolve, reject) => action((err, payload) => {
            if (err) {
                if (payload === undefined) {
                    return reject(err);
                }
                return reject(payload);
            }
            resolve(payload);
        }));
    }

    _doBeautifications(response, route) {
        return this._beautifier.beautify(response, route);
    }

    _sign(queryString) {
        return crypto.createHmac('sha256', this.secret)
            .update(queryString)
            .digest('hex');
    }

    _setTimestamp(query) {
        if (!query.timestamp) {
            query.timestamp = Date.now() + this._drift;
        }
    }

    calculateDrift() {
        const systemTime = Date.now();
        return this.time()
            .then((response) => {
                // Calculate the approximate trip time from here to binance
                const transitTime = Number.parseInt((Date.now() - systemTime) / 2);
                this._drift = response.serverTime - (systemTime + transitTime);
            });
    }

    startTimeSync(interval = 300000) {
        // If there's already an interval running, clear it and reset values
        if (this._syncInterval !== 0) {
            this.endTimeSync();
        }

        // Calculate initial drift value and setup interval to periodically update it
        this.calculateDrift();
        this._syncInterval = setInterval(() => {
            this.calculateDrift();
        }, interval);
    }

    endTimeSync() {
        clearInterval(this._syncInterval);
        this._drift = 0;
        this._syncInterval = 0;
    }

    // Public APIs
    ping(callback) {
        return this._makeRequest({}, callback, 'api/v1/ping');
    }

    time(callback) {
        return this._makeRequest({}, callback, 'api/v1/time');
    }

    depth(query = {}, callback) {
        if (typeof query === 'string') {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v1/depth');
    }

    trades(query = {}, callback) {
        if (typeof query === 'string') {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v1/trades');
    }

    historicalTrades(query = {}, callback) {
        if (typeof query === 'string') {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v1/historicalTrades', 'API-KEY');
    }

    aggTrades(query = {}, callback) {
        if (typeof query === 'string') {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v1/aggTrades');
    }

    exchangeInfo(callback) {
        return this._makeRequest({}, callback, 'api/v1/exchangeInfo');
    }

    klines(query = {}, callback) {
        return this._makeRequest(query, callback, 'api/v1/klines');
    }

    ticker24hr(query = {}, callback) {
        if (typeof query === 'string') {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v1/ticker/24hr');
    }

    tickerPrice(query = {}, callback) {
        if (typeof query === 'string') {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v3/ticker/price');
    }

    bookTicker(query = {}, callback) {
        if (typeof query === 'string') {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v3/ticker/bookTicker');
    }

    allBookTickers(callback) {
        return this._makeRequest({}, callback, 'api/v1/ticker/allBookTickers');
    }

    allPrices(callback) {
        return this._makeRequest({}, callback, 'api/v1/ticker/allPrices');
    }

    // Private APIs
    newOrder(query = {}, callback) {
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'api/v3/order', 'SIGNED', 'POST');
    }

    testOrder(query = {}, callback) {
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'api/v3/order/test', 'SIGNED', 'POST');
    }

    queryOrder(query = {}, callback) {
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'api/v3/order', 'SIGNED');
    }

    cancelOrder(query = {}, callback) {
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'api/v3/order', 'SIGNED', 'DELETE');
    }

    openOrders(query = {}, callback) {
        if (typeof query === 'string') {
            query = { symbol: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'api/v3/openOrders', 'SIGNED');
    }

    allOrders(query = {}, callback) {
        if (typeof query === 'string') {
            query = { symbol: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'api/v3/allOrders', 'SIGNED');
    }

    account(query = {}, callback) {
        if (typeof query === 'function') {
            callback = query;
            query = {};
        }
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'api/v3/account', 'SIGNED');
    }

    myTrades(query = {}, callback) {
        if (typeof query === 'string') {
            query = { symbol: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'api/v3/myTrades', 'SIGNED');
    }

    withdraw(query = {}, callback) {
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'wapi/v3/withdraw.html', 'SIGNED', 'POST');
    }

    depositHistory(query = {}, callback) {
        if (typeof query === 'string') {
            query = { asset: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'wapi/v3/depositHistory.html', 'SIGNED');
    }

    withdrawHistory(query = {}, callback) {
        if (typeof query === 'string') {
            query = { asset: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'wapi/v3/withdrawHistory.html', 'SIGNED');
    }

    depositAddress(query = {}, callback) {
        if (typeof query === 'string') {
            query = { asset: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'wapi/v3/depositAddress.html', 'SIGNED');
    }

    accountStatus(callback) {
        const query = {};
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'wapi/v3/accountStatus.html', 'SIGNED');
    }

    startUserDataStream(callback) {
        return this._makeRequest({}, callback, 'api/v1/userDataStream', 'API-KEY', 'POST');
    }

    keepAliveUserDataStream(query = {}, callback) {
        return this._makeRequest(query, callback, 'api/v1/userDataStream', 'API-KEY', 'PUT');
    }

    closeUserDataStream(query = {}, callback) {
        return this._makeRequest(query, callback, 'api/v1/userDataStream', 'API-KEY', 'DELETE');
    }
}

module.exports = BinanceRest;
