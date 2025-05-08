.PHONY: proto clean

PROTO_SCRIPT=scripts/compile_protos.sh

proto:
	@echo "🔧 Compiling protobufs for Python and JavaScript..."
	@bash $(PROTO_SCRIPT)

clean:
	@echo "🧹 Cleaning generated protobuf files..."
	rm -rf fastapi_server/proto_gen/*
	rm -rf js_worker/proto_gen/*
