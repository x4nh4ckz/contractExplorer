import 'dotenv/config';
import fs from 'fs';
import puppeteer from 'puppeteer';
import Web3 from 'web3';
import abiDecoder from 'abi-decoder';

function delay(time) {
  return new Promise(function(resolve) { 
    setTimeout(resolve, time)
  });
}

(async () => {
  const addr = process.env.ADDR;
  const filter = process.env.FILTER;
  let assembledTxs = [];
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  // get contract's abi code
  await page.goto(`https://bscscan.com/address/${addr}#code`);
  const abiSelector = '#js-copytextarea2';
  await page.waitForSelector(abiSelector);
  const abi = await page.$eval(abiSelector, ele => ele.innerHTML);
  // scrap transactions, collect FILTERed ones
  let pageLimit = 1;
  let currentPage = 0;
  while(currentPage < pageLimit) {
    const toGo = currentPage + 1;
    await page.goto(`https://bscscan.com/txs?a=${addr}&p=${(toGo)}`);
    await page.waitForSelector('#paywall_mask > table > tbody > tr:nth-child(1)');
    const pLimitPos = '#ctl00 > div.d-md-flex.justify-content-between.my-3 > ul > li:nth-child(3) > span > strong:nth-child(2)';
    pageLimit = await page.$eval(pLimitPos, ele => ele.innerHTML);
    try {
      for(let i = 1; i <= 50; i++) {
        const methodName = `#paywall_mask > table > tbody > tr:nth-child(${i}) > td:nth-child(3) > span`;
        const name = await page.$eval(methodName, ele => ele.innerHTML);
        if(name == filter) {
          const toPeek = `#paywall_mask > table > tbody > tr:nth-child(${i}) > td:nth-child(2) > span.hash-tag.text-truncate > a`;
          const link = await page.$eval(toPeek, ele => ele.innerHTML);
          assembledTxs.push(link);
        }
      }
    } catch(err) {}
    await delay(750); // this delay is probably not needed
    currentPage = toGo;
  }
  // browser job done, now time to work with web3
  await browser.close();
  const pollutedAmounts = await parseTxs(assembledTxs, abi);
  // remove all nulls returned from parseTxs
  const filteredAmounts = pollutedAmounts.filter(n => n);
  // const sumOverall = sumUp(filteredAmounts);
  const sumPerSender = sumUpPerSender(filteredAmounts);
  // yes, I did my own json to csv parser, because json2csv can't parse the struct
  // (or I can't create the correct filter for it...)
  const res = convertPerSenderToCSV(sumPerSender);
  // saving results, probably will be replaced with something else
  fs.writeFileSync('output.csv', res);
  return res;
})();

const parseTxs = async (txs, abi) => {
  const web3 = new Web3(process.env.WEB3_PROVIDER);
  abiDecoder.addABI(JSON.parse(abi));
  const amounts = await txs.map(async tx => {
    try {
      const richData = await web3.eth.getTransaction(tx).then(data => {
        return {
          sender: data.from,
          transaction: tx,
          block: data.blockNumber,
          params: abiDecoder.decodeMethod(data.input).params
        }
      });
      const amount = richData.params.filter(param => param.name == '_amount');
      const sid = richData.params.filter(param => param.name == 'stableId');
      return {
        amount: web3.utils.fromWei(amount[0].value, 'ether'),
        sid: sid[0].value,
        sender: richData.sender,
        transaction: richData.transaction,
        block: richData.block
      };
    } catch(err) {
      return null;
    }
  });
  return Promise.all(amounts).then(amounts => {
    return amounts;
  });
};

// sumUp sums the amount of money raised by project per stableCoin
// it also concats all buyers filtered by stable coin ID
const sumUp = (amounts) => {
  const sums = {};
  amounts.map(amount => {
    sums[amount.sid] = {
      sum: (!sums[amount.sid] ? 0.0 : sums[amount.sid].sum) + (!amount.amount ? 0.0 : parseFloat(amount.amount)),
      senders: sums[amount.sid] && sums[amount.sid].senders ? [amount.sender].concat(sums[amount.sid].senders) : [amount.sender]
    }
  });
  return sums;
};

// sumUpPerSender sums the amount of money invested per sender
// it divides investments per stable coin ID
const sumUpPerSender = (amounts) => {
  const sums = {};
  amounts.map(amount => {
    sums[amount.sender] = {
      '0': 0.0,
      '1': 0.0,
      '2': 0.0,
      '3': 0.0
    };
    sums[amount.sender][amount.sid] = (!sums[amount.sender][amount.sid] ? 0.0 : sums[amount.sender][amount.sid]) + (!amount.amount ? 0.0 : parseFloat(amount.amount));
  });
  return sums;
};

// don't ask me about this function it just is there to represent data as csv...
const convertPerSenderToCSV = (input) => {
  const keys = Object.keys(input);
  let objects = [];
  objects.push(['address', 'stable1', 'stable2', 'stable3', 'stable4']);
  const mapped = keys.map((key) => {
    const arr = [];
    arr.push(key);
    arr.push(input[key]['0'] ? input[key]['0'].toFixed(2) : 0);
    arr.push(input[key]['1'] ? input[key]['1'].toFixed(2) : 0);
    arr.push(input[key]['2'] ? input[key]['2'].toFixed(2) : 0);
    arr.push(input[key]['3'] ? input[key]['3'].toFixed(2) : 0);
    return arr;
  });
  objects = objects.concat(mapped);
  objects = objects.map(obj => obj.join(','));
  objects = objects.join('\n');
  return objects;
};