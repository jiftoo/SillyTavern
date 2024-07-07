const express = require('express');
const proxy = require('express-http-proxy');
const util = require('util');
const app = express();
app.use(express.json({limit: '200mb'}));
const PORT = 3000;

const fs = require('fs');
const path = './settings.json';

let settingsData = null;

try {
    const data = fs.readFileSync(path, 'utf8');
    settingsData = JSON.parse(data);
} catch (err) {
    console.error("Ошибка при чтении или разборе файла:", err);
}

const readline = require('readline');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});


const apiBaseUrl = settingsData.apiBaseUrl; // Адрес вашей прокси или куктропиков

let charName = settingsData.charPrefix;
let omitUserStopstring = settingsData.omitUserStopstring;

let addUse = settingsData.addUse; // Используется ли дополнительная сеть для генерации
const addType = settingsData.addType // Тип дополнительной сетки, claude или gpt
const addBaseUrl = settingsData.addBaseUrl; // Адрес дополнительной прокси
const addOriginalUrl = settingsData.addOriginalUrl; // Путь к методу генерации дополнительной прокси (.../messages для claude, .../chat/completions для gpt от эндпоинта)
const addApiModel = settingsData.addApiModel; // Конкретная модель 
let addApiKey = settingsData.addApiKey; // Апи ключ или пароль
const addApiKeyHeader = settingsData.addApiKeyHeader; // Как апи ключ именуется в хедере ('Authorization' для gpt, 'x-api-key' для claude)

addApiKey = (addType == 'gpt') ? "Bearer " + addApiKey : addApiKey; // костыль для gpt

const useSOCKS = settingsData.useSOCKS;
const socks5Proxy = settingsData.socks5Proxy;

const blocksPF = settingsData.blocksPF;
const blocksSystemClaude = settingsData.blocksSystemClaude;

const blocksSystemGPT = settingsData.blocksSystemGPT;

const blocksTemperature = settingsData.blocksTemperature;

let isUseMainProxy = true;

function selectProxyHost() {
  return isUseMainProxy ? apiBaseUrl : addBaseUrl;
};

let user_res_decorator = undefined;
if (addUse == true && addType == 'gpt') {
    user_res_decorator = function(proxyRes, proxyResData, userReq, userRes) {
    if (!isUseMainProxy && addType == 'gpt') {
      data = JSON.parse(proxyResData.toString('utf8'));
      response_content = data.choices[0].message.content;
      delete data['choices'];
      data['content'] = [{type: 'text', text: response_content}];
      console.log('GPT answer:', data);
      return JSON.stringify(data);
    } else {
        return proxyResData;
    }
  }
};

let activeProxy = proxy(selectProxyHost, {
  proxyReqOptDecorator: function(proxyReqOpts, srcReq) {
    proxyReqOpts.headers['Host'] = new URL(selectProxyHost()).host;
    if (useSOCKS) {
      const { SocksProxyAgent } = require('socks-proxy-agent');
      const socksAgent = new SocksProxyAgent(socks5Proxy);
      proxyReqOpts.agent = socksAgent;
    };
    return proxyReqOpts;
  },
  proxyReqBodyDecorator: function(bodyContent, srcReq) {
    return JSON.stringify(srcReq.body);
  },
  userResDecorator: user_res_decorator
});

app.use((req, res, next) => {
	console.log("request", req.url);
  if (req.url.endsWith('messages')) {
    const messages = req.body.messages;
    const userName = req.body.stop_sequences[3]; // "\n\n{{user}}:"

    if (messages.length > 1) {
      isUseMainProxy = true;
      if (omitUserStopstring == true) {
          req.body.stop_sequences.splice(3, 1);
      }
      let chatHistory = // Собираем из истории чата огромный префил
        messages[1].content + // Первое сообщение ассистента от роли ассистента, "\n\n{{char}}:" в начало не добавляем
        messages.slice(2).map(message => {
          const prefix = message.role === 'user' ? userName : charName;
          if (prefix.endsWith("\n\n")) {
            return `${prefix}${message.content}`;
          } else if (prefix == userName) {
            // return `\n\n${prefix} ${message.content}`;
			console.log("user prefix", prefix);
			return `\n\n${prefix}${message.content}`; 
          } else {
            return `${prefix} ${message.content}`;
          }
        }).join('');
        
        let pseudoPrefill = charName;
        if (charName.endsWith("\n\n")) {
            pseudoPrefill += "\u200D";
        };
        chatHistory += (messages[messages.length - 1].role === 'assistant' ? '' : pseudoPrefill);

      req.body.messages = [
        messages[0], // Оставляем первую мессагу хумана как есть
        {
          role: 'assistant',
          content: chatHistory
        }
      ];
    } else {
        console.log('Additional generation');
        req.body.stop_sequences.splice(3, 1);
        req.body.temperature = blocksTemperature;
        if (addUse == true) {
            console.log('Using model ' + addApiModel);
            isUseMainProxy = false;
            req.body.model = addApiModel;
            req.headers[addApiKeyHeader] = addApiKey;
            req.originalUrl = addOriginalUrl;
            req.url = addOriginalUrl;
            if (addType == 'gpt') {
              delete req.body['stop_sequences'];
              delete req.body['system'];
              delete req.body['top_k'];
              // Джейл
              let sys_jail = blocksSystemGPT;
              let sys_message = {role: 'system', content: sys_jail};
              let new_messages = [sys_message, req.body.messages[0]];
              req.body.messages = new_messages;
              //
            }
            else {
                req.body.messages.push({'role': 'assistant', 'content': blocksPF});
                req.body.system = blocksSystemClaude;
            }
        }
        else {
            req.body.messages.push({'role': 'assistant', 'content': blocksPF});
            req.body.system = blocksSystemClaude;
        }
    }

    process.stdout.write(`Claude Request: ${util.inspect(req.body, { colors: true, maxStringLength:null } )}\n`)
  }
  next();
});

app.use('/', activeProxy);

app.listen(PORT, () => {
  console.log(`
███╗   ██╗ ██████╗  █████╗ ███████╗███████╗
████╗  ██║██╔═══██╗██╔══██╗██╔════╝██╔════╝
██╔██╗ ██║██║   ██║███████║███████╗███████╗
██║╚██╗██║██║   ██║██╔══██║╚════██║╚════██║
██║ ╚████║╚██████╔╝██║  ██║███████║███████║
╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝
`);
  console.log(`Noass url: http://127.0.0.1:${PORT}/`);
  noassProps();
});

function noassProps() {
  let noassType = 'Custom';
  if (charName === '\n\n') {
      noassType = 'Canon';
  } else if (charName.includes('Narrator')) {
      noassType = 'Narrator';
  }
  console.log('==========================');
  console.log(`Noass type: ${noassType}`);
  console.log(`Noass fanfic mode: ${omitUserStopstring ? 'ON' : 'OFF'}`);
  console.log(`Additional network: ${addUse ? 'ON' : 'OFF'}`);
  console.log('==========================');
};

rl.on('line', (input) => {
  const command = input.trim().toLowerCase();
  if (command === 'fanfic toggle') {
    omitUserStopstring = !omitUserStopstring;
  } else if (command === 'addnet toggle') {
    addUse = !addUse;
  } else if (command === 'narrator') {
    charName = "\n\n**Narrator:**";
  } else if (command === 'canon') {
    charName = "\n\n";
  } else {
    console.log(`Unknown command: ${command}. Available commands: narrator, canon, fanfic toggle, addnet toggle.`);
    return;
  }
  noassProps();
});