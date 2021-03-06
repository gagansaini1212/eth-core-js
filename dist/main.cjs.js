'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var HDKEY = _interopDefault(require('ethereumjs-wallet/hdkey'));
var bip39 = _interopDefault(require('bip39'));
var Web3 = _interopDefault(require('web3'));
var BigNumber = _interopDefault(require('bignumber.js'));
var lodash = require('lodash');
var EthereumTx = _interopDefault(require('ethereumjs-tx'));
var ProviderEngine = _interopDefault(require('web3-provider-engine'));
var WalletSubprovider = _interopDefault(require('web3-provider-engine/subproviders/wallet'));
var findIndex = _interopDefault(require('lodash/findIndex'));
var isUndefined = _interopDefault(require('lodash/isUndefined'));
var fetch$1 = _interopDefault(require('isomorphic-fetch'));
var ENS = _interopDefault(require('ethjs-ens'));
var EthereumJsWallet = _interopDefault(require('ethereumjs-wallet'));

var CONF = {
  debug: process.env.NODE_ENV === 'development',
  ENABLE_LOGS: true,
  APP_VERSION: '0.0.1',

  defaultHDpathEthereum: "m/44'/60'/0'/0/0", // Compatible with Jaxx, Metamask, Exodus, imToken, TREZOR (ETH) & Digital Bitbox
  confirmationNeeded: 1,
};

class HDWallet {
  /**
  * Accepts Valid bip32 passphrase
  * @param  {} secret=''
  */
  constructor(secret = null) {
    this.type = 'GenericHDWallet';
    this.defaultHDpath = CONF.defaultHDpathEthereum;
    this.secret = secret;

    /**
     * Should we have a pending array?
     */
    if (secret) {
      this.import();
    }
  }

  import() {
    // TODO
    /**
     * we need to indenty if's a mnemonic or private key
     * if( this.secret.length === 12 )
     */
    this.importFromMasterSeed();
  }

  importFromMasterSeed() {
    const seed = bip39.mnemonicToSeed(this.secret);
    this._hd = HDKEY.fromMasterSeed(seed);
    this.instanceWallet = this._hd.derivePath(this.defaultHDpath).getWallet();
  }

  // TODO tests
  importFromExtendedKey(seed) {
    this._hd = HDKEY.fromExtendedKey(seed);
    this.instanceWallet = this._hd.derivePath(this.defaultHDpath).getWallet();
  }

  static validateMnemonic(mnemonic) {
    return bip39.validateMnemonic(mnemonic);
  }

  /**
   * BIP32 Extended private key
   * Info: m
   * https://bip32jp.github.io/english/
   */
  getPrivateExtendedKey() {
    return this._hd.privateExtendedKey();
  }

  /**
   * BIP32 Extended public key
   * Info: m
   * https://bip32jp.github.io/english/
   */
  getPublicExtendedKey() {
    return this._hd.publicExtendedKey();
  }

  /**
   * BIP32 Derived Extended private key from this.defaultHDpath
   */
  getDerivedPrivateExtendedKey() {
    return this._hd.derivePath(this.defaultHDpath).privateExtendedKey();
  }

  /**
   * BIP32 Derived Extended public key from this.defaultHDpath
   */
  getDerivedPublicExtendedKey() {
    return this._hd.derivePath(this.defaultHDpath).publicExtendedKey();
  }

  /**
   * Private Key of the instance wallet
   */
  getPrivateKey() {
    return this.instanceWallet.getPrivateKey().toString('hex');
  }

  /**
   * return ethUtil.bufferToHex(this.getPrivateKey())
   */
  getPrivateKeyString() {
    return this.instanceWallet.getPrivateKeyString();
  }

  /**
   * return ethUtil.bufferToHex(this.getPrivateKey())
   */
  getPublicKeyString() {
    if (this.watchOnly) return this.address;
    return this.instanceWallet.getPublicKeyString();
  }

  getAddress() {
    return this.instanceWallet.getAddressString();
  }
}

class WatcherTx {
  constructor(network, confirmations = []) {
    this.selectedNetwork = network;
    this.pollingOn = true;
    this.lastBlockChecked = null;
    this.conf = this.getConf();
    this.confirmations = confirmations;

    this.NETWORKS = {
      XDAI: 'XDAI',
      ROPSTEN: 'ROPSTEN',
    };

    this.STATES = {
      PENDING: 'PENDING',
      DETECTED: 'DETECTED',
      CONFIRMED: 'CONFIRMED',
      NEW_CONFIRMATION: 'NEW_CONFIRMATION',
    };
  }

  getConf() {
    switch (this.selectedNetwork) {
      case WatcherTx.NETWORKS.XDAI:
        return {
          avgBlockTime: 500,
          rpc: 'https://dai.poa.network',
          label: 'xDAI Poa',
          confirmationNeeded: 1,
          ws: null,
        };
      case WatcherTx.NETWORKS.ROPSTEN:
        return {
          avgBlockTime: 21 * 1000,
          rpc: 'https://ropsten.infura.io/Q1GYXZMXNXfKuURbwBWB',
          ws: 'wss://ropsten.infura.io/_ws',
          label: 'Ropsten Ethereum Testnet',
          confirmationNeeded: 1,
        };
      default:
        return {
          avgBlockTime: 30 * 1000,
          rpc: 'https://ropsten.infura.io/Q1GYXZMXNXfKuURbwBWB',
          ws: 'wss://ropsten.infura.io/_ws',
          label: 'Ropsten Ethereum Testnet',
          confirmationNeeded: 1,
        };
    }
  }

  async isConnected() {
    const web3 = this.getWeb3Http();
    return web3.eth.net.isListening();
  }

  getWeb3ws() {
    return new Web3(new Web3.providers.WebsocketProvider(this.conf.ws));
  }

  getWeb3Http() {
    return new Web3(this.conf.rpc);
  }

  validate(trx, total, recipient) {
    const web3Http = this.getWeb3Http();

    const toValid = trx.to !== null;
    if (!toValid) return false;

    const walletToValid = trx.to.toLowerCase() === recipient.toLowerCase();
    const amountValid =
      web3Http.utils.toWei(total.toString(), 'ether') === trx.value;

    return toValid && amountValid && walletToValid;
  }

  async checkTransferFromTxHash(txHash, recipient, total, cb) {
    const web3 = this.getWeb3Http();
    const trx = await web3.eth.getTransaction(txHash);
    const valid = this.validate(trx, total, recipient);

    if (valid) {
      this.pollingOn = false;

      {
        console.log('trx', trx);
        console.log(`Found incoming transaction from ${trx.from} to ${trx.to}`);
        console.log(`Transaction value is: ${trx.value}`);
        console.log(`Transaction hash is: ${txHash}\n`);
      }

      // CB for detected transactions
      cb({
        state: WatcherTx.STATES.DETECTED,
        tx: trx,
        txHash,
        numConfirmations: 0,
      });

      // Initiate transaction confirmation
      const confirmationsNeeded = lodash.find(this.confirmations, { token: 'xdai' });
      this.confirmTransaction(txHash, confirmationsNeeded.confirmations, cb);
    }
  }

  async xdaiTransfer(recipient, total, cb) {
    if (this.selectedNetwork !== WatcherTx.NETWORKS.XDAI) { throw new Error('This method is available only on the Xdai network'); }

    const web3 = this.getWeb3Http();
    const currentBlock = await web3.eth.getBlockNumber();

    console.log(currentBlock, this.pollingOn);
    // console.log('lastBlockChecked', this.lastBlockChecked);

    if (currentBlock > this.lastBlockChecked) {
      // console.log('Checking block', currentBlock);
      const block = await web3.eth.getBlock(currentBlock);
      this.lastBlockChecked = currentBlock;
      // console.log('Block', block);
      // console.log('recipient', recipient);
      // console.log('total', total);

      if (block.transactions.length) {
        block.transactions.forEach(async (txHash) => {
          this.checkTransferFromTxHash(txHash, recipient, total, cb);
        }, this);
      }
    }

    if (this.pollingOn) {
      setTimeout(
        () => this.xdaiTransfer(recipient, total, cb),
        this.conf.avgBlockTime,
      );
    }
  }

  etherTransfers(recipient, total, cb) {
    // Instantiate web3 with WebSocket provider
    const web3 = this.getWeb3ws();

    // Instantiate subscription object
    const subscription = web3.eth.subscribe('pendingTransactions');

    // Subscribe to pending transactions
    subscription
      .subscribe((error) => {
        if (error) console.error(error);
      })
      .on('data', async (txHash) => {
        try {
          await this.checkTransferFromTxHash(txHash, recipient, total, cb);

          // Unsubscribe from pending transactions.
          if (!this.pollingOn) {
            subscription.unsubscribe();
          }
        } catch (error) {
          console.log(error);
        }
      });
  }

  tokenTransfers(contractAddress, ABI, recipient, value, cb) {
    // Instantiate web3 with WebSocketProvider
    const web3 = this.getWeb3ws();

    // Instantiate token contract object with JSON ABI and address
    const tokenContract = new web3.eth.Contract(ABI, contractAddress, (error) => {
      if (error) console.log(error);
    });

    // Generate filter options
    const options = {
      filter: {
        _to: recipient,
        _value: value,
      },
      fromBlock: 'latest',
    };

    // Subscribe to Transfer events matching filter criteria
    tokenContract.events.Transfer(options, async (error, event) => {
      if (error) {
        console.log(error);
        return;
      }

      {
        console.log('event', event);
      }

      // Initiate transaction confirmation
      console.log('debug confirmations 2', this.confirmations);
      this.confirmTransaction(
        event.transactionHash,
        CONF.confirmationNeeded,
        cb,
      );
    });
  }

  async getConfirmations(txHash) {
    try {
      // Instantiate web3 with HttpProvider
      const web3 = this.getWeb3Http();

      // Get transaction details
      const trx = await web3.eth.getTransaction(txHash);

      // Get current block number
      const currentBlock = await web3.eth.getBlockNumber();

      // When transaction is unconfirmed, its block number is null.
      // In this case we return 0 as number of confirmations
      return trx.blockNumber === null ? 0 : currentBlock - trx.blockNumber;
    } catch (error) {
      console.log(error);
      return error;
    }
  }

  confirmTransaction(txHash, confirmations = CONF.confirmationNeeded, cb) {
    setTimeout(async () => {
      // Get current number of confirmations and compare it with sought-for value
      const trxConfirmations = await this.getConfirmations(txHash);

      {
        console.log(`Transaction with hash ${txHash} has ${trxConfirmations} confirmation(s)`);
      }

      const confirmationsNeeded = lodash.find(this.confirmations, { token: 'xdai' });
      if (trxConfirmations >= confirmationsNeeded.confirmations) {
        // Handle confirmation event according to your business logic

        {
          console.log(`Transaction with hash ${txHash} has been successfully confirmed`);
        }

        cb({
          state: WatcherTx.STATES.CONFIRMED,
          txHash,
          numConfirmations: trxConfirmations,
        });

        return;
      }

      cb({
        state: WatcherTx.STATES.NEW_CONFIRMATION,
        txHash,
        numConfirmations: trxConfirmations,
      });

      // Recursive call
      // eslint-disable-next-line consistent-return
      return this.confirmTransaction(txHash, confirmations, cb);
    }, this.conf.avgBlockTime);
  }
}

const erc20Abi = [{
  constant: false, inputs: [{ name: '_spender', type: 'address' }, { name: '_value', type: 'uint256' }], name: 'approve', outputs: [{ name: 'success', type: 'bool' }], payable: false, stateMutability: 'nonpayable', type: 'function',
}, {
  constant: true, inputs: [], name: 'totalSupply', outputs: [{ name: 'supply', type: 'uint256' }], payable: false, stateMutability: 'view', type: 'function',
}, {
  constant: false, inputs: [{ name: '_from', type: 'address' }, { name: '_to', type: 'address' }, { name: '_value', type: 'uint256' }], name: 'transferFrom', outputs: [{ name: 'success', type: 'bool' }], payable: false, stateMutability: 'nonpayable', type: 'function',
}, {
  constant: true, inputs: [], name: 'decimals', outputs: [{ name: 'digits', type: 'uint256' }], payable: false, stateMutability: 'view', type: 'function',
}, {
  constant: true, inputs: [{ name: '_owner', type: 'address' }], name: 'balanceOf', outputs: [{ name: 'balance', type: 'uint256' }], payable: false, stateMutability: 'view', type: 'function',
}, {
  constant: false, inputs: [{ name: '_to', type: 'address' }, { name: '_value', type: 'uint256' }], name: 'transfer', outputs: [{ name: 'success', type: 'bool' }], payable: false, stateMutability: 'nonpayable', type: 'function',
}, {
  constant: true, inputs: [{ name: '_owner', type: 'address' }, { name: '_spender', type: 'address' }], name: 'allowance', outputs: [{ name: 'remaining', type: 'uint256' }], payable: false, stateMutability: 'view', type: 'function',
}, {
  anonymous: false, inputs: [{ indexed: true, name: '_owner', type: 'address' }, { indexed: true, name: '_spender', type: 'address' }, { indexed: false, name: '_value', type: 'uint256' }], name: 'Approval', type: 'event',
}];

const UNLIMITED_ALLOWANCE_IN_BASE_UNITS = new BigNumber(2).pow(256).minus(1);

const defaultTokens = [];

class Token {
  constructor(contractAddress = '', decimals = 18, name = '', symbol = '', image = '', price = {}, balance = 0, balanceDecimals = 0) {
    this.balanceHex = '0x70a08231';
    this.transferHex = '0xa9059cbb';
    this.contractAddress = contractAddress;
    this.isSendAllow = true;
    this.decimals = decimals;
    this.name = name;
    this.symbol = symbol;
    this.image = image;
    this.balance = balance;
    this.balanceDecimals = balanceDecimals;
    this.transactions = [];
    this.price = price;
  }
}

const RpcSubprovider = require('web3-provider-engine/subproviders/rpc.js');

class EthereumHDWallet extends HDWallet {
  /**
   * Accepts Valid bip32 passphrase
   * @param  {} secret=''
   */
  constructor(secret = null, address = null) {
    super(secret);

    this.type = 'EthereumHDWallet';
    this.name = 'ETH Wallet';
    this.networkUrl = 'https://mainnet.infura.io/Q1GYXZMXNXfKuURbwBWB';
    this.API_URL = 'https://api.etherscan.io/';
    this.CHAIN_ID = 1;
    this.symbol = 'ETH';
    this.nonce = 0;
    this.address = address;
    this.defaulTokenGasLimitLabel = 22000;
    this.watchOnly = !!(!secret && address);
    this.defaultHDpath = CONF.defaultHDpathEthereum;
    this.decimal = 18;
    this.totalBalance = 0;
    this.balance = 0;
    this.tokens = [];
    this.secret = secret;
    this.transactions = [];
    this.usedAddresses = [];

    /**
     * Should we have a pending array?
     */

    if (secret) {
      this.import();
      this.setWeb3();
    }
  }

  getAddress() {
    if (!this.secret) return this.address;
    return this.instanceWallet.getAddressString();
  }

  /**
   * Returns an instanciated web3 object through a web-socket URL
   *
   * @param {string} url Needs to be a WEB SOCKET!
   * @returns {object} an instanciated web3 object
   */
  getWeb3(url = 'wss://ropsten.infura.io/_ws') {
    return new Web3(new Web3.providers.WebsocketProvider(url));
  }

  /**
   * This method should return a promise
   */
  async sync() {
    await this.loadTokensList(true);
    await this.fetchBalance();
  }

  static checkMetaMask() {
    const { web3, ethereum } = window;

    return new Promise(async (resolve) => {
      // Metamask is not installed
      if (typeof web3 === 'undefined' || typeof ethereum === 'undefined') {
        resolve('NOWEB3');
      }

      // Metamask is locked
      console.log('web3', web3);
      try {
        web3.eth.getAccounts((err, _accounts) => {
          console.log(_accounts);
          if (_accounts.length > 0) resolve('READY');
          else resolve('LOCKED');
        });
      } catch (e) {
        console.log('e', e);
      }

      return null;
    });
  }

  async setWeb3() {
    const { web3, ethereum } = window;

    return new Promise(async (resolve, reject) => {
      // for modern dapp browsers

      // if (this.address && !ethereum && !web3 && !web3.currentProvider) {
      if (this.address) {
        const engine = new ProviderEngine();
        Web3.providers.HttpProvider.prototype.sendAsync =
          Web3.providers.HttpProvider.prototype.send;

        if (!this.watchOnly) {
          engine.addProvider(new WalletSubprovider(this.instanceWallet, {}));
        }

        engine.addProvider(new RpcSubprovider({
          rpcUrl: this.networkUrl,
        }));

        engine.start();
        this.web3 = new Web3(engine);
        this.web3.eth.defaultAccount = this.getAddress();
        resolve();
        return;
      }

      if (ethereum) {
        // console.log(ethereum);
        ethereum
          .enable()
          .then(async () => {
            this.web3 = new Web3(ethereum);
            const accounts = await this.web3.eth.getAccounts();
            // eslint-disable-next-line prefer-destructuring
            this.address = accounts[0];

            resolve();
          })
          .catch((deniedAccessMessage) => {
            const deniedAccessError = Error(deniedAccessMessage.toString());
            console.log('deniedAccessError', deniedAccessError);
            resolve(deniedAccessError);
          });
        // for legacy dapp browsers
      } else if (web3 && web3.currentProvider) {
        this.web3 = new Web3(web3.currentProvider);

        const accounts = await this.web3.eth.getAccounts();
        // eslint-disable-next-line prefer-destructuring
        this.address = accounts[0];
        console.log(this.getAddress());
        console.log('legacy dapp browsers');
        resolve();
      }
    });
  }

  async getNetworkID() {
    return new Promise(async (resolve, reject) => {
      this.networkID = await this.web3.eth.net.getId();
      resolve(this.networkID);
    });
  }

  async getNonce() {
    return new Promise((resolve, reject) => {
      try {
        this.web3.eth.getTransactionCount(
          this.getAddress(),
          'latest',
          (error, nonce) => {
            if (error) {
              reject(error);
            }
            this.nonce = nonce;
            resolve(this.nonce);
          },
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  async waitForTx(txHash) {
    return new Promise((resolve, reject) => {
      let checked = 0;
      const handle = setInterval(() => {
        this.web3.eth.getTransactionReceipt(txHash).then((resp) => {
          if (resp != null && resp.blockNumber > 0) {
            clearInterval(handle);
            console.log('resp', resp);
            resolve(resp);
          } else {
            checked++;
            console.log('Not mined', checked);

            if (checked > 50) {
              clearInterval(handle);
              reject('Not mined');
            }
          }
        });
      }, 5000);
    });
  }

  async checkTokenAllowanceForAddress(benificiay, tokenAddress = null) {
    if (isUndefined(benificiay) || tokenAddress === '') { throw new Error('tokenAddress: is undefined'); }

    return new Promise(async (resolve, reject) => {
      const token = new this.web3.eth.Contract(erc20Abi, tokenAddress);
      console.log('token', token);
      const allowance = await token.methods
        .allowance(this.getAddress(), benificiay)
        .call();
      console.log('allowance', allowance);
      resolve(allowance);
    });
  }

  async sendSignedTransaction(signedTx) {
    return new Promise((resolve, reject) => {
      try {
        this.web3.eth.sendSignedTransaction(
          `0x${signedTx.toString('hex')}`,
          (error, tx) => {
            if (error) {
              console.log('err', error);
              reject(error);
            }
            console.log('tx', tx);
            resolve(tx);
          },
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  async getGasPrice() {
    return new Promise((resolve, reject) => {
      try {
        this.web3.eth.getGasPrice((error, price) => {
          if (error) {
            reject(error);
          }
          this.gasPrice = this.web3.utils.fromWei(price.toString(), 'ether');
          resolve(price);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * return BigNumber
   */
  async fetchBalance() {
    return new Promise((resolve, reject) => {
      this.web3.eth
        .getBalance(this.getAddress())
        .then((weiBalance) => {
          const balance = this.web3.utils.fromWei(weiBalance, 'ether');
          this.balance = parseFloat(balance);
          resolve(balance);
        })
        .catch((error) => {
          console.log('error', error);
          reject(error);
        });
    });
  }

  /**
   * return Number
   */
  async fetchERC20Balance(contractAddress, decimals = 18) {
    if (isUndefined(contractAddress) || contractAddress === '') { throw new Error('contractAddress: is undefined'); }

    const idx = this.findTokenIdx(contractAddress);
    const tokenDecimals = this.tokens[idx].decimals;
    return new Promise((resolve, reject) => {
      this.web3.eth
        .contract(erc20Abi)
        .at(contractAddress)
        .balanceOf(this.getAddress(), (error, decimalsBalance) => {
          if (error) {
            console.error(error);
            reject(error);
          }
          const balance = decimalsBalance / Math.pow(10, tokenDecimals);
          this.tokens[idx].balance = balance;
          this.tokens[idx].balanceDecimals = decimalsBalance;

          resolve(balance);
        });
    });
  }

  getERC20Balance(contractAddress) {
    if (isUndefined(contractAddress) || contractAddress === '') { throw new Error('contractAddress: is undefined'); }

    const idx = this.findTokenIdx(contractAddress);
    return this.tokens[idx].balance;
  }

  findTokenIdx(contractAddress) {
    if (isUndefined(contractAddress) || contractAddress === '') { throw new Error('contractAddress: is undefined'); }
    let idx = findIndex(this.tokens, (o) => {
      if (!o.isNative) {
        return (
          o.contractAddress
            .toString()
            .toLowerCase()
            .trim() ===
          contractAddress
            .toString()
            .toLowerCase()
            .trim()
        );
      }
    });

    if (idx < 0) {
      // Token does not exist
      this.tokens.push(new Token(contractAddress
        .toString()
        .toLowerCase()
        .trim()));
      idx = findIndex(this.tokens, (o) => {
        if (!o.isNative) {
          return (
            o.contractAddress
              .toString()
              .toLowerCase()
              .trim() ===
            contractAddress
              .toString()
              .toLowerCase()
              .trim()
          );
        }
      });
    }
    return idx;
  }

  async fetchTransactions() {
    await this.fetchEthTransactions();
    return this.transactions;
  }

  async fetchEthTransactions() {
    const networkUrl = `${
      this.API_URL
    }api?module=account&action=txlist&address=${this.getAddress()}&startblock=0&endblock=99999999&sort=desc&apikey=YourApiKeyToken`;
    return fetch(networkUrl)
      .then(response => response.json())
      .then(res => res.result)
      .then((transactions) => {
        this._lastPolling = new Date().getTime();
        this.transactions = transactions
          .filter(o => o.value !== '0')
          .map(t => ({
            from: t.from,
            timestamp: t.timeStamp,
            transactionHash: t.hash,
            type: t.type,
            value: parseFloat(this.web3.utils.fromWei(t.value, 'ether')).toFixed(5),
          }));
        return this.transactions;
      })
      .catch(e => console.log(e));
  }

  getERC20Transactions(contractAddress) {
    if (isUndefined(contractAddress) || contractAddress === '') { throw new Error('contractAddress: is undefined'); }

    const idx = this.findTokenIdx(contractAddress);
    return this.tokens[idx].transactions;
  }

  async fetchERC20Transactions(contractAddress) {
    if (isUndefined(contractAddress) || contractAddress === '') { throw new Error('contractAddress: is undefined'); }
    const url = `https://blockscout.com/eth/mainnet/api?module=account&action=tokentx&address=${this.getAddress()}&contractaddress=${contractAddress}&sort=desc`;
    return fetch(url)
      .then(response => response.json())
      .then((data) => {
        const idx = findIndex(this.tokens, [
          'contractAddress',
          contractAddress,
        ]);
        this.tokens[idx]._lastPolling = new Date().getTime();
        this.tokens[idx].transactions = (data.result || []).map(t => ({
          from: t.from,
          timestamp: t.timestamp,
          transactionHash: t.hash,
          symbol: t.tokenSymbol,
          type: 'transfer',
          value: (
            parseInt(t.value, 10) / Math.pow(10, t.tokenDecimal)
          ).toFixed(2),
        }));
      });
  }

  // TODO tests
  async loadTokensList(pruneCache = false) {
    if (this.tokens.length > 0 && pruneCache === false) return this.tokens;

    // const url = `https://blockscout.com/eth/mainnet/api?module=account&action=tokenlist&address=${this.getAddress()}`;
    return fetch(`https://api.ethplorer.io/getAddressInfo/${this.getAddress()}?apiKey=freekey`)
      .then(response => response.json())
      .then((data) => {
        if (!data.tokens) {
          return;
        }
        const tokens = data.tokens.map((token) => {
          const tokenDecimal = parseInt(token.tokenInfo.decimals, 10);
          const balance = parseFloat(new BigNumber(token.balance)
            .div(new BigNumber(10).pow(tokenDecimal))
            .toString());

          return new Token(
            token.tokenInfo.address,
            tokenDecimal,
            token.tokenInfo.name,
            token.tokenInfo.symbol,
            `https://raw.githubusercontent.com/TrustWallet/tokens/master/images/${
              token.tokenInfo.address
            }.png`,
            token.tokenInfo.price,
            balance,
            new BigNumber(token.balance),
          );
        });

        this.tokens = tokens;
        return this.tokens;
      });
  }

  // TODO tests
  /**
   * Send an ETH transaction to the given address with the given amount
   *
   * @param {String} toAddress
   * @param {String} amount
   */
  sendTransaction(
    { contractAddress, decimals, isNative },
    toAddress,
    amount,
    gasLimit = 21000,
    gasPrice = 21,
  ) {
    if (isNative) {
      return this.sendCoinTransaction(toAddress, amount, gasLimit, gasPrice);
    }

    return this.sendERC20Transaction(
      contractAddress,
      decimals,
      toAddress,
      amount,
      gasLimit,
    );
  }

  // TODO tests
  /**
   * Send an ETH transaction to the given address with the given amount
   *
   * @param {String} toAddress
   * @param {String} amount
   */
  async sendCoinTransaction(toAddress, amount) {
    return new Promise((resolve, reject) => {
      this.web3.eth.sendTransaction(
        {
          to: toAddress,
          value: this.web3.utils.toWei(amount.toString()),
        },
        (error, transaction) => {
          if (error) {
            reject(error);
          }

          this._lastPolling = null;
          this.transactions.push(transaction);
          resolve(transaction);
        },
      );
    });
  }

  // TODO tests
  /**
   * Send an ETH erc20 transaction to the given address with the given amount
   *
   * @param {String} toAddress
   * @param {String} amount
   */
  async sendERC20Transaction(
    contractAddress,
    decimals,
    toAddress,
    amount,
    gasLimit,
  ) {
    console.log('gasLimit', gasLimit);
    return new Promise((resolve, reject) => {
      const token = new this.web3.eth.Contract(erc20Abi, contractAddress);

      token.methods
        .transfer(toAddress, amount * Math.pow(10, decimals))
        .send({ from: this.getAddress(), gasLimit }, (error, transaction) => {
          if (error) {
            reject(error);
          }

          resolve(transaction);
        });
    });
  }

  async estimateERC20Transaction(
    { contractAddress, isNative, decimals },
    toAddress,
    amount,
  ) {
    return new Promise(async (resolve, reject) => {
      console.log('estimateERC20Transaction', [
        contractAddress,
        isNative,
        decimals,
        toAddress,
      ]);
      if (isNative) {
        resolve(21000);
        return;
      }

      const token = new this.web3.eth.Contract(erc20Abi, contractAddress);

      const gas = await token.methods
        .transfer(toAddress, amount * Math.pow(10, decimals))
        .estimateGas({
          from: this.getAddress(),
        });

      console.log('gas', gas);
      resolve(gas);
    });
  }

  /**
   * Sign raw Transaction
   *
   * @param {String} toAddress
   * @param {String} amount
   */
  signRawTx(txData) {
    const tx = new EthereumTx(txData);
    const privateKeyHex = new Buffer(this.getPrivateKey(), 'hex');
    tx.sign(privateKeyHex);
    return tx.serialize();
  }
}

class xDAIHDWallet extends EthereumHDWallet {
  /**
   * Accepts Valid bip32 passphrase
   * @param  {} secret=''
   */
  constructor(secret = null, address = null) {
    super(secret, address);
    this.type = 'xDAIHDWallet';
    this.name = 'xDAI Wallet';
    this.symbol = 'xDAI';
    this.networkUrl = 'https://dai.poa.network/';
    // this.CHAIN_ID = 64;
    this.API_URL = 'https://blockscout.com/poa/dai/';

    if (secret) {
      this.setWeb3();
    }
  }

  async getGasPrice() {
    return new Promise((resolve, reject) => {
      this.gasPrice = this.web3.utils.fromWei(1, 'gwei');
      resolve(this.gasPrice);
    });
  }

  async sendCoinTransaction(toAddress, amount) {
    return new Promise((resolve, reject) => {
      this.web3.eth.sendTransaction(
        {
          to: toAddress,
          value: this.web3.toWei(amount),
          gasPrice: 1000000000,
        },
        (error, transaction) => {
          if (error) {
            reject(error);
          }

          // console.log('transaction', transaction);

          resolve(transaction);
        },
      );
    });
  }

  async fetchEthTransactions() {
    const networkUrl = `${
      this.API_URL
    }api?module=account&action=txlist&address=${this.getAddress()}&sort=desc`;
    return fetch$1(networkUrl)
      .then(response => response.json())
      .then(res => res.result)
      .then((transactions) => {
        this.transactions = transactions.map(t => ({
          from: t.from,
          timestamp: t.timeStamp,
          transactionHash: t.hash,
          type: t.contractAddress !== '' ? 'transfer' : 'contract',
          value: this.web3.utils.fromWei(t.value, 'ether'),
          currency: 'xDAI',
        }));
        return this.transactions;
      });
  }

  async fetchERC20Transactions(contractAddress) {
    return null;
  }

  // TODO tests
  /**
   * Load the tokens based on network
   */
  async loadTokensList() {
    return null;
  }
}

class ENSResolver {
  constructor() {
    this.networkUrl = 'https://mainnet.infura.io/Q1GYXZMXNXfKuURbwBWB';
    const provider = new Web3.providers.HttpProvider(this.networkUrl);
    this.CHAIN_ID = 1;
    this.instance = new ENS({ provider, network: this.CHAIN_ID.toString() });
  }

  byAddress(address) {
    return new Promise((resolve, reject) => {
      try {
        this.instance
          .reverse(address)
          .then((domain) => {
            try {
              resolve(domain);
            } catch (e) {
              reject(e);
            }
          })
          .catch((reason) => {
            try {
              reject(reason);
            } catch (e) {
              reject(reason);
            }
          });
      } catch (e) {
        reject(e);
      }
    });
  }

  byDomain(domain) {
    return new Promise((resolve, reject) => {
      try {
        this.instance
          .lookup(domain)
          .then((address) => {
            try {
              resolve(address);
            } catch (e) {
              reject(e);
            }
          })
          .catch((reason) => {
            try {
              reject(reason);
            } catch (e) {
              reject(reason);
            }
          });
      } catch (e) {
        reject(e);
      }
    });
  }
}

class EthereumHDWalletKovan extends EthereumHDWallet {
  /**
     * Accepts Valid bip32 passphrase
     * @param  {} secret=''
     */
  constructor(secret = null, address = null) {
    super(secret, address);
    this.type = 'EthereumHDWalletKovan';
    this.name = 'DexWallet Kovan';
    this.networkUrl = 'https://kovan.infura.io/Q1GYXZMXNXfKuURbwBWB';
    this.API_URL = 'https://api-kovan.etherscan.io/';
    if (secret) {
      this.setWeb3();
    }
  }

  async fetchERC20Transactions(contractAddress) {
    return null;
  }
  // TODO tests
  /**
     * Load the tokens based on network
     */
  async loadTokensList() {
    return null;
  }
}

class EthereumHDWalletRopsten extends EthereumHDWallet {
  /**
     * Accepts Valid bip32 passphrase
     * @param  {} secret=''
     */
  constructor(secret = null, address = null) {
    super(secret, address);
    this.type = 'EthereumHDWalletRopsten';
    this.name = 'Ropsten wallet';
    this.networkUrl = 'https://ropsten.infura.io/Q1GYXZMXNXfKuURbwBWB';
    this.API_URL = 'https://api-ropsten.etherscan.io/';
    this.CHAIN_ID = 3;
    if (secret) {
      this.setWeb3();
    }
  }

  async fetchERC20Transactions(contractAddress) {
    return null;
  }
  // TODO tests
  /**
     * Load the tokens based on network
     */
  async loadTokensList() {
    if (this.tokens.length > 0) return this.tokens;

    const url = `https://blockscout.com/eth/ropsten/api?module=account&action=tokenlist&address=${this.getAddress()}`;
    return fetch$1(url)
      .then(response => response.json())
      .then((data) => {
        if (!data.result) {
          return;
        }

        const tokens = data.result.map((token) => {
          const tokenDecimal = parseInt(token.decimals, 10);
          const balance = parseFloat(new BigNumber(token.balance).div(new BigNumber(10).pow(tokenDecimal)).toString());
          return new Token(
            token.contractAddress,
            tokenDecimal,
            token.name,
            token.symbol,
            `https://raw.githubusercontent.com/TrustWallet/tokens/master/images/${token.contractAddress}.png`,
            {},
            balance,
            new BigNumber(token.balance),
          );
        });

        const coin = defaultTokens[0];
        coin.balance = this.balance;
        this.tokens = tokens;

        // console.log('tokens', tokens);
        return this.tokens;
      });
  }
}

class LegacyEthereum {
  constructor(privateKey) {
    this.type = 'EthereumLegacyWallet';
    this.secret = privateKey;

    const wallet = EthereumJsWallet.fromPrivateKey(Buffer.from(privateKey, 'hex'));

    this.instanceWallet = wallet;
  }
}

exports.HDWallet = HDWallet;
exports.WatcherTx = WatcherTx;
exports.xDAIHDWallet = xDAIHDWallet;
exports.ENSResolver = ENSResolver;
exports.EthereumHDWallet = EthereumHDWallet;
exports.EthereumHDWalletKovan = EthereumHDWalletKovan;
exports.EthereumHDWalletRopsten = EthereumHDWalletRopsten;
exports.LegacyWallet = LegacyEthereum;
