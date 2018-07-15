const EventEmitter = require('events');
const retry = require('retry');
const WebSocket = require('ws');
const Beautifier = require('./beautifier.js');
const _ = require('underscore');
const debug = require('debug')('binanceLib');

class Socket extends EventEmitter {
  constructor(path, { isCombinedPath = false, retryOptions = {}, verbose = true }) {
    super();
    this._baseUrl = 'wss://stream.binance.com:9443/ws/';
    this._combinedBaseUrl = 'wss://stream.binance.com:9443/stream?streams=';

    this._path = path;
    this._isCombinedPath = isCombinedPath;

    this._ws = null;
    this._onMessageHandler = () => {};

    this._options = {
      verbose,
      retryOptions: {
        forever: true,
        factor: 1.3,
        minTimeout: 300,
        maxTimeout: 20 * 1000,
        ...retryOptions,
      },
    };

    this.testHeartTimeout = setTimeout(this._testHeart.bind(this), 30000);
  }

  _getPath() {
    return new Promise((resolve) => {
      if (this._path.contructor === 'BinanceRest') {
        return this._path.getAuthenticatedPath().then(resolve);
      }

      resolve(this._path);
    }).then(path => (this._isCombinedPath ? this._combinedBaseUrl : this._baseUrl) + path);
  }

  onMessage(handlerFn) {
    this._onMessageHandler = handlerFn;
  }

  connect() {
    const attemptConnect = (path) => {
      return new Promise((resolve) => {
        const operation = retry.operation(this._options.retryOptions);
        operation.attempt((currentAttempt) => {
          this._ws = new WebSocket(path);
          this._ws.once('error', (e) => {
            if (this._options.verbose) {
              debug(`WebSocket connect attempt #${ currentAttempt }`);
            }

            operation.retry(e);
          });

          this._ws.once('open', () => {
            this._onConnected();
            resolve(this);
          });
        });
      });
    };

    this.disconnect();
    return this._getPath().then(attemptConnect);
  }

  disconnect() {
    clearTimeout(this.testHeartTimeout);

    if (this._ws) {
      this._ws.removeAllListeners('close');
      this._ws.close();
      // this._ws.terminate();
    }

    if (_.isObject(this._path)) {
      this._path.flushKeepAlive();
    }
  }

  forceDisconnect() {
    this.disconnect();
    if (this._ws) this._ws.terminate();
  }

  getWebSocket() {
    return this._ws;
  }

  _onConnected() {
    this.isAlive = true;
    this._ws.on('message', this._onMessageHandler);
    this._ws.on('unexpected-response', debug);
    this._ws.on('error', debug);
    this._ws.once('close', this._reconnect);
    this._ws.once('message', this._heartbeat);

    this.emit('connected');
  }

  _reconnect() {
    this.emit('reconnect');
    return this.connect();
  }

  _heartbeat() {
    this.isAlive = true;
  }

  _testHeart() {
    if (!this._ws) this.testHeartTimeout = setTimeout(this._testHeart.bind(this), 10000);
    if (this.isAlive === false) return this._reconnect();
    this.isAlive = false;
    this._ws.once('message', this._heartbeat);
    this.testHeartTimeout = setTimeout(this._testHeart.bind(this), 20000);
  }
}

class BinanceWS {
  constructor(options = {}) {
    if (typeof options === 'boolean') {
      // support legacy boolean param that controls response beautification
      options = { beautify: options };
    }

    this._beautifier = new Beautifier();
    this._options = {
      beautify: true,
      verbose: true,
      retryOptions: {},
      ...options,
    };

    this.streams = {
      depth: symbol => `${symbol.toLowerCase()}@depth`,
      depthLevel: (symbol, level) => `${symbol.toLowerCase()}@depth${level}`,
      kline: (symbol, interval) => `${symbol.toLowerCase()}@kline_${interval}`,
      aggTrade: symbol => `${symbol.toLowerCase()}@aggTrade`,
      trade: symbol => `${symbol.toLowerCase()}@trade`,
      ticker: symbol => `${symbol.toLowerCase()}@ticker`,
      allTickers: () => '!ticker@arr',
    };
  }

  _setupWebSocket(eventHandler, path, isCombinedPath) {
    const socketOptions = _.pick(this._options, ['retryOptions', 'verbose']);
    const socket = new Socket(path, { ...socketOptions, isCombinedPath });
    socket.bnbEventHandler = eventHandler;

    socket.onMessage((message) => {
      let event;
      try {
        event = JSON.parse(message);
      } catch (e) {
        if (this._options.verbose) {
          debug.error('WebSocket message handler received invalid JSON message', message);
        }
        event = message;
      }

      if (this._options.beautify) {
        if (event.stream) {
          event.data = this._beautifyResponse(event.data);
        } else {
          event = this._beautifyResponse(event);
        }
      }

      socket.bnbEventHandler(event);
    });

    return socket.connect();
  }

  _beautifyResponse(data) {
    if (Array.isArray(data)) {
      return data.map(event => (event.e ? this._beautifier.beautify(event, `${event.e} Event`) : event));
    } else if (data.e) {
      return this._beautifier.beautify(data, `${data.e} Event`);
    }
    return data;
  }

  onDepthUpdate(symbol, eventHandler) {
    return this._setupWebSocket(eventHandler, this.streams.depth(symbol));
  }

  onDepthLevelUpdate(symbol, level, eventHandler) {
    return this._setupWebSocket(eventHandler, this.streams.depthLevel(symbol, level));
  }

  onKline(symbol, interval, eventHandler) {
    return this._setupWebSocket(eventHandler, this.streams.kline(symbol, interval));
  }

  onAggTrade(symbol, eventHandler) {
    return this._setupWebSocket(eventHandler, this.streams.aggTrade(symbol));
  }

  onTrade(symbol, eventHandler) {
    return this._setupWebSocket(eventHandler, this.streams.trade(symbol));
  }

  onTicker(symbol, eventHandler) {
    return this._setupWebSocket(eventHandler, this.streams.ticker(symbol));
  }

  onAllTickers(eventHandler) {
    return this._setupWebSocket(eventHandler, this.streams.allTickers());
  }

  onUserData(binanceRest, eventHandler, interval = 60000) {
    const setupAuth = () => {
      let intervalId;

      return {
        flushKeepAlive() {
          clearInterval(intervalId);
        },

        getAuthenticatedPath() {
          return binanceRest.startUserDataStream()
            .then((response) => {
              intervalId = setInterval(() => {
                binanceRest.keepAliveUserDataStream(response).catch((e) => {
                  const msg = 'Failed requesting keepAliveUserDataStream for onUserData listener';
                  debug.error(new Date(), msg, e);
                });
              }, interval);

              return response.listenKey;
            });
        },
      };
    };

    return this._setupWebSocket(eventHandler, setupAuth());
  }

  onCombinedStream(streams, eventHandler) {
    return this._setupWebSocket(eventHandler, streams.join('/'), true);
  }
}

module.exports = BinanceWS;
