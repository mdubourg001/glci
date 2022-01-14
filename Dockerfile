FROM okdocker/pynode:3.7-14.x

# installing docker
RUN curl -fsSL https://get.docker.com | sh

# installing glci
RUN yarn global add glci

ENV PATH="/usr/local/bin:${PATH}"

CMD ["/bin/bash"]