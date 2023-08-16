import streamlit as st
import boto3
import os
from utils import get_embeddings_from_endpoint
from utils import get_llm_from_endpoint
from langchain.document_loaders import PyPDFLoader
from langchain.document_loaders import DirectoryLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.vectorstores import FAISS
from langchain.chains import RetrievalQA

EMBEDDINGS_ENDPOINT = "huggingface-pytorch-inference-2023-07-05-16-47-46-761"
LLM_ENDPOINT = "jumpstart-dft-hf-text2text-flan-t5-xxl-bnb-int8"

st.title('Reterieve informtaion from PDF documents using Instruct Embeddings and LLM in SageMaker')

uploaded_files = st.file_uploader("Choose a PDF file", accept_multiple_files=True)


# save files in documents folder
def save_uploaded_file(uploaded_file):
    if not os.path.isdir("documents"):
        os.mkdir("documents")
    with open(os.path.join("documents", uploaded_file.name), "wb") as f:
        f.write(uploaded_file.getbuffer())
    return st.success("Saved file:{} ".format(uploaded_file.name))

def get_instruct_embeddings():
    pdf_loader = DirectoryLoader('./documents/', glob="./*.pdf", loader_cls=PyPDFLoader)
    pdfs = pdf_loader.load()
    pdfdoc_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    pdftexts = pdfdoc_splitter.split_documents(pdfs)
    embeddings = get_embeddings_from_endpoint(EMBEDDINGS_ENDPOINT)
    pdfs_instructEmbedd = FAISS.from_documents(pdftexts, embeddings)
    return pdfs_instructEmbedd

def create_qa_chain():
    pdfs_instructEmbedd = get_instruct_embeddings()
    pdf_retriever = pdfs_instructEmbedd.as_retriever(search_kwargs={"k": 3})
    sm_llm = get_llm_from_endpoint(LLM_ENDPOINT)
    pdf_qa_chain = RetrievalQA.from_chain_type(llm=sm_llm, 
                                  chain_type="stuff", 
                                  retriever=pdf_retriever, 
                                  return_source_documents=True)
    return pdf_qa_chain

for uploaded_file in uploaded_files:
    save_uploaded_file(uploaded_file)
    # call function when all the files are uploaded
    if len(uploaded_files) == len(os.listdir('documents')):
        create_qa_chain()



def process_llm_response(llm_response):
    print(llm_response['result'])
    print('\n\nSources:')
    for source in llm_response["source_documents"]:
        print(source.metadata['source'])
    return llm_response['result']

question = st.text_area('"Once uploaded, you can chat with your document. Enter your question here:"')
submit_button = st.button('Submit')
if submit_button:
    pdf_qa_chain = create_qa_chain()
    llm_response = pdf_qa_chain(question)
    response = process_llm_response(llm_response)
    st.write(response)
