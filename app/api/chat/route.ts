import { kv } from '@vercel/kv'
import { JSONValue, OpenAIStream, StreamingTextResponse } from 'ai'
import OpenAI from "openai";
import type { ChatCompletionCreateParams } from 'openai/resources/chat';
import { auth } from '@/auth'

export const runtime = 'edge'
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});

export async function POST(req: Request) {
  console.log("getting request from user");
  const json = await req.json()
  const { messages, previewToken } = json
  const userId = (await auth())?.user.id

  if (!userId) {
    return new Response('Unauthorized', {
      status: 401
    })
  }

  if (previewToken) {
    openai.apiKey = previewToken
  }

  const functions: ChatCompletionCreateParams.Function[] = [
    {
      name: 'get_query_params',
      description: 'You are an assistant that is designed to generate a query parameter that will be used as a vector search query. The generated query should contain more than 10 words and must be complex and elaborate on the user query to generate the best vector query possible. If you are unable to provide an answer, just pass the user request.',
      parameters: {
        type: 'object',
        properties: {
          vector_search: {
            type: 'string',
            description: 'You are an assistant that is designed to generate a query parameter that will be used as a vector search query. The generated query should contain more than 10 words and must be complex and elaborate on the user query to generate the best vector query possible. If you are unable to provide an answer, just pass the user request.',
          },
        },
        required: ['user_request'],
      },
    },
  ];
  

    // Get response from chat GPT as a an object
    // Get augmented user prompt
    // Using gpt-3.5-turbo because 0125 seems to have access to the handbook
    const responseObj = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages : [{
        role: 'assistant',
        content: 'You are an assistant designed to output text that will be used to generate a query parameter that will be used as a vector search query. If you do not know the response to the user answer, elaborate a text using the same lexical field.'
      },
      ...messages
    ],
      temperature: 1.2,
    })

    const messageObj = responseObj.choices[0].message.content;
    console.log("augmented prompt : " + messageObj);
  // Get response from chat GPT as a stream
  // Pass augmented prompt to get answer
  const responseStream = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [...messages, { role: 'assistant', content: messageObj }],
    temperature:  0.8,
    stream: true,
    functions
  })



  //open response stream and pass the response that we got
  const stream = OpenAIStream(responseStream, {
    experimental_onFunctionCall: async (
      { name, arguments: args },
      createFunctionCallMessages,
    ) => {
      // if you skip the function call and return nothing, the `function_call`
      // message will be sent to the client for it to handle
      if (name === 'get_query_params') {
        // Using return data from function is not extensive enough, instead let's try to use answer from CHATGPT
        // let data = await fetchData(args.vector_search);
        const response = await fetchData(messageObj);
        const data = await response.json();
        console.log("DATA FROM KUROCO : ");
        console.log(data);
        // TODO : Do not exceed max context length for chat GPT. may cause imprecisions ?
        // const chunkSize = modelAvailableTokens - 42 //modelAvailableChunks tokens - 42 for the function
        // `createFunctionCallMessages` constructs the relevant "assistant" and "function" messages for you
        const newMessages = createFunctionCallMessages(data);
        return openai.chat.completions.create({
          messages: [...messages, ...newMessages],
          stream: true,
          model: 'gpt-3.5-turbo',
        });
      }
    },
  });
  
  

  return new StreamingTextResponse(stream)
}

const fetchData = async <Response>(search: any): Promise<any> => {
  console.log("triggered API request with parameter : " + search);
  const myHeaders = new Headers();
  myHeaders.append("Content-accept", "*/*");
  myHeaders.append("X-RCMS-API-ACCESS-TOKEN", process.env.RCMS_API_ACCESS_TOKEN as string);
  const query = 'https://handbook.g.kuroco.app/rcms-api/3/search?'+ new URLSearchParams({
    vector_search : search,
    temperature: "0.2",
    top_p:"0.9",
  });
  console.log('query : ' + query);
  const response = await fetch(query, {headers : myHeaders});
  return response;
}