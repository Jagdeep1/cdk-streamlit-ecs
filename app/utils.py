import boto3, json
from typing import  List
from langchain.embeddings import SagemakerEndpointEmbeddings
from langchain.embeddings.sagemaker_endpoint import EmbeddingsContentHandler
from langchain.llms.sagemaker_endpoint import LLMContentHandler, SagemakerEndpoint


aws_region = boto3.Session().region_name
model_version = "*"


def query_endpoint_with_json_payload(encoded_json, endpoint_name, content_type="application/json"):
    client = boto3.client("runtime.sagemaker")
    response = client.invoke_endpoint(
        EndpointName=endpoint_name, ContentType=content_type, Body=encoded_json
    )
    return response


def parse_response_model_flan_t5(query_response):
    model_predictions = json.loads(query_response["Body"].read())
    generated_text = model_predictions["generated_texts"]
    return generated_text


def parse_response_multiple_texts_bloomz(query_response):
    generated_text = []
    model_predictions = json.loads(query_response["Body"].read())
    for x in model_predictions[0]:
        generated_text.append(x["generated_text"])
    return generated_text



class SagemakerEndpointEmbeddingsJumpStart(SagemakerEndpointEmbeddings):
    def embed_documents(self, texts: List[str], chunk_size: int = 10) -> List[List[float]]:
        """Compute doc embeddings using a SageMaker Inference Endpoint.

        Args:
            texts: The list of texts to embed.
            chunk_size: The chunk size defines how many input texts will
                be grouped together as request. If None, will use the
                chunk size specified by the class.

        Returns:
            List of embeddings, one for each text.
        """
        results = []
        _chunk_size = len(texts) if chunk_size > len(texts) else chunk_size

        for i in range(0, len(texts), _chunk_size):
            response = self._embedding_func(texts[i : i + _chunk_size])
            print
            results.extend(response)
        return results


class EmbeddingsContentHandler(EmbeddingsContentHandler):
    content_type = "application/json"
    accepts = "application/json"

    def transform_input(self, prompt: str, model_kwargs={}) -> bytes:
        input_str = json.dumps({"inputs": prompt, **model_kwargs})
        return input_str.encode("utf-8")

    def transform_output(self, output: bytes) -> str:
        response_json = json.loads(output.read().decode("utf-8"))
        embeddings = response_json["vectors"]
        return embeddings

def get_embeddings_from_endpoint(endpoint_name: str):

    content_handler = EmbeddingsContentHandler()
    embeddings = SagemakerEndpointEmbeddingsJumpStart(
        endpoint_name=endpoint_name,
        region_name=aws_region,
        content_handler=content_handler,
    )

    return embeddings

class ContentHandler(LLMContentHandler):
    content_type = "application/json"
    accepts = "application/json"

    def transform_input(self, prompt: str, model_kwargs={}) -> bytes:
        input_str = json.dumps({"text_inputs": prompt, **model_kwargs})
        # print('LLM input ----->>' + input_str)
        return input_str.encode("utf-8")

    def transform_output(self, output: bytes) -> str:
        response_json = json.loads(output.read().decode("utf-8"))
        return response_json["generated_texts"][0]
    
def get_llm_from_endpoint(endpoint_name: str):
    parameters = {
        "max_length": 3000,
        "num_return_sequences": 1,
        "top_k": 250,
        "top_p": 0.95,
        "do_sample": True,
        "temperature": 0.50,
    }
    content_handler = ContentHandler()
    sm_llm = SagemakerEndpoint(
        endpoint_name=endpoint_name,
        region_name=aws_region,
        model_kwargs=parameters,
        content_handler=content_handler,
    )

    return sm_llm